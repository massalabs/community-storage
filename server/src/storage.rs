//! Simple filesystem storage backend with indexing by namespace and id.
//! Data is stored under `{storage_path}/{namespace}/{id}`; listing reads directory metadata.
//! Optional per-blob metadata (e.g. min_replication) is stored in `{id}.meta` (JSON).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use uuid::Uuid;

/// Allowed range for uploader-requested minimum replication (1 = single copy only).
pub const MIN_REPLICATION_MIN: u8 = 1;
pub const MIN_REPLICATION_MAX: u8 = 32;

/// Per-blob metadata stored in `{id}.meta`. Used so that when P2P replication is
/// implemented, the system can enforce the uploader's minimum replication requirement.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BlobMeta {
    /// Minimum number of replicas the uploader requested (1 = no requirement beyond single copy).
    pub min_replication: u8,
    /// Massa address of the uploader (when upload auth was used). Omitted for legacy uploads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uploader_address: Option<String>,
}

fn meta_path_for_id(ns_path: &Path, id: &str) -> PathBuf {
    ns_path.join(format!("{}.meta", id))
}

/// Read BlobMeta from `{id}.meta`; returns default (min_replication=1, no uploader) if missing/invalid.
fn read_blob_meta(ns_path: &Path, id: &str) -> BlobMeta {
    let meta_path = meta_path_for_id(ns_path, id);
    let contents = match fs::read_to_string(&meta_path) {
        Ok(c) => c,
        Err(_) => {
            return BlobMeta {
                min_replication: MIN_REPLICATION_MIN,
                uploader_address: None,
            }
        }
    };
    let meta: BlobMeta = match serde_json::from_str(&contents) {
        Ok(m) => m,
        Err(_) => {
            return BlobMeta {
                min_replication: MIN_REPLICATION_MIN,
                uploader_address: None,
            }
        }
    };
    meta
}

/// Sanitize a segment for use in paths (namespace or id): only alphanumeric, dash, underscore.
fn sanitize_segment(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            c
        } else {
            '_'
        })
        .collect()
}

/// Simple filesystem-backed storage.
#[derive(Clone)]
pub struct Storage {
    base: PathBuf,
    /// put() rejects uploads that would exceed this total size (bytes).
    storage_limit_bytes: u64,
}

#[derive(Debug, serde::Serialize)]
pub struct IndexEntry {
    /// Massa address of the uploader (when upload auth was used). Null for legacy uploads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uploader_address: Option<String>,
    pub id: String,
    pub namespace: String,
    pub size: u64,
    pub created_at: u64,
    /// Minimum replication requested by the uploader (1 if no metadata or not set).
    pub min_replication: u8,
}

impl Storage {
    pub fn new(base: PathBuf, storage_limit_bytes: u64) -> Self {
        Self {
            base,
            storage_limit_bytes,
        }
    }

    /// Storage limit in bytes (set from STORAGE_LIMIT_GB at startup).
    pub fn storage_limit_bytes(&self) -> u64 {
        self.storage_limit_bytes
    }

    /// Total size in bytes of all files under the storage base directory.
    pub fn total_size(&self) -> io::Result<u64> {
        fn dir_size(path: &Path) -> io::Result<u64> {
            let mut total: u64 = 0;
            if path.is_dir() {
                for entry in fs::read_dir(path)? {
                    let entry = entry?;
                    let path = entry.path();
                    if path.is_dir() {
                        total += dir_size(&path)?;
                    } else {
                        total += entry.metadata()?.len();
                    }
                }
            }
            Ok(total)
        }
        dir_size(&self.base)
    }

    /// Ensure base and namespace dirs exist.
    fn ensure_namespace(&self, namespace: &str) -> io::Result<PathBuf> {
        let ns = sanitize_segment(namespace);
        if ns.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "namespace must not be empty after sanitization",
            ));
        }
        let path = self.base.join(&ns);
        fs::create_dir_all(&path)?;
        Ok(path)
    }

    /// Store raw bytes under namespace with optional id; returns the id used.
    /// Returns an error if current usage + data would exceed the storage limit.
    /// `min_replication` and optional `uploader_address` are stored in `{id}.meta`.
    pub fn put(
        &self,
        namespace: &str,
        id_hint: Option<&str>,
        data: &[u8],
        min_replication: u8,
        uploader_address: Option<String>,
    ) -> io::Result<String> {
        let current = self.total_size()?;
        let new_total = current.saturating_add(data.len() as u64);
        if new_total > self.storage_limit_bytes {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                format!(
                    "storage limit exceeded: current {} bytes, limit {} bytes, upload {} bytes",
                    current, self.storage_limit_bytes, data.len()
                ),
            ));
        }
        let ns_path = self.ensure_namespace(namespace)?;
        let id = id_hint
            .map(|s| sanitize_segment(s))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let path = ns_path.join(&id);
        fs::write(&path, data)?;
        let meta = BlobMeta {
            min_replication,
            uploader_address,
        };
        let meta_path = meta_path_for_id(&ns_path, &id);
        fs::write(
            meta_path,
            serde_json::to_string(&meta).expect("BlobMeta serialization is infallible"),
        )?;
        Ok(id)
    }

    /// Get raw bytes by namespace and id.
    pub fn get(&self, namespace: &str, id: &str) -> io::Result<Vec<u8>> {
        let ns = sanitize_segment(namespace);
        let id = sanitize_segment(id);
        if ns.is_empty() || id.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "namespace and id must be non-empty",
            ));
        }
        let path = self.base.join(&ns).join(&id);
        fs::read(&path)
    }

    /// List entries in a namespace (optional). If namespace is None, list all namespaces' entries.
    pub fn list(&self, namespace: Option<&str>) -> io::Result<Vec<IndexEntry>> {
        let mut entries = Vec::new();
        let base = self.base.as_path();

        if let Some(ns) = namespace {
            let ns = sanitize_segment(ns);
            if ns.is_empty() {
                return Ok(entries);
            }
            let ns_path = base.join(&ns);
            if !ns_path.is_dir() {
                return Ok(entries);
            }
            self.list_in_dir(&ns_path, &ns, &mut entries)?;
        } else {
            if !base.is_dir() {
                return Ok(entries);
            }
            for entry in fs::read_dir(base)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    let ns = entry
                        .file_name()
                        .into_string()
                        .unwrap_or_default();
                    self.list_in_dir(&path, &ns, &mut entries)?;
                }
            }
        }

        Ok(entries)
    }

    fn list_in_dir(
        &self,
        dir: &Path,
        namespace: &str,
        out: &mut Vec<IndexEntry>,
    ) -> io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() {
                let name = entry
                    .file_name()
                    .into_string()
                    .unwrap_or_default();
                // Skip metadata sidecar files
                if name.ends_with(".meta") {
                    continue;
                }
                let id = name;
                let meta = entry.metadata()?;
                let size = meta.len();
                let created_at = meta
                    .created()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let meta = read_blob_meta(dir, &id);
                out.push(IndexEntry {
                    uploader_address: meta.uploader_address,
                    id,
                    namespace: namespace.to_string(),
                    size,
                    created_at,
                    min_replication: meta.min_replication,
                });
            }
        }
        Ok(())
    }
}

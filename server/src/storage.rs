//! Simple filesystem storage backend with indexing by namespace and id.
//! Data is stored under `{storage_path}/{namespace}/{id}`; listing reads directory metadata.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use uuid::Uuid;

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
}

#[derive(Debug, serde::Serialize)]
pub struct IndexEntry {
    pub id: String,
    pub namespace: String,
    pub size: u64,
    pub created_at: u64,
}

impl Storage {
    pub fn new(base: PathBuf) -> Self {
        Self { base }
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
    pub fn put(
        &self,
        namespace: &str,
        id_hint: Option<&str>,
        data: &[u8],
    ) -> io::Result<String> {
        let ns_path = self.ensure_namespace(namespace)?;
        let id = id_hint
            .map(|s| sanitize_segment(s))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let path = ns_path.join(&id);
        fs::write(&path, data)?;
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
                let id = entry
                    .file_name()
                    .into_string()
                    .unwrap_or_default();
                let meta = entry.metadata()?;
                let size = meta.len();
                let created_at = meta
                    .created()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                out.push(IndexEntry {
                    id,
                    namespace: namespace.to_string(),
                    size,
                    created_at,
                });
            }
        }
        Ok(())
    }
}

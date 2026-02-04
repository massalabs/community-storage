//! HTTP API: upload and read endpoints.

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;

use crate::auth::verify_upload_signature;
use crate::contract::MassaClient;
use crate::sc_client::get_is_allowed_uploader;
use crate::storage::{Storage, MIN_REPLICATION_MAX, MIN_REPLICATION_MIN};

/// Auth config for upload: when set, POST /upload requires Massa signature + storage admin.
#[derive(Clone)]
pub struct UploadAuthConfig {
    pub storage_registry_address: String,
    pub massa_json_rpc: String,
}
use crate::p2p::SharedP2pState;

#[derive(Clone)]
pub struct AppState {
    pub storage: Storage,
    /// When present, uploads require X-Massa-* headers and getIsAllowedUploader(addr).
    pub upload_auth: Option<UploadAuthConfig>,
    /// Discovered P2P listen addresses (filtered to exclude localhost).
    pub p2p_listen_addrs: Arc<std::sync::RwLock<Vec<String>>>,
    pub p2p_state: Option<SharedP2pState>,
    /// Massa client for contract writes (recordFileUpload). Present when gRPC is configured.
    pub massa_client: Option<Arc<MassaClient>>,
}

/// Query for list: optional namespace filter.
#[derive(Debug, serde::Deserialize)]
pub struct ListQuery {
    pub namespace: Option<String>,
}

/// Upload: optional query params and min_replication (uploader-requested minimum replicas).
#[derive(Debug, serde::Deserialize)]
pub struct UploadQuery {
    pub namespace: Option<String>,
    pub id: Option<String>,
    /// Minimum number of replicas the uploader requires (1–32). Default 1 when omitted.
    pub min_replication: Option<u8>,
}

/// POST /upload
/// Body: raw binary data.
/// When upload auth is enabled: requires X-Massa-Address, X-Massa-Signature, X-Massa-Public-Key;
/// verifies signature (Blake3(body) + Ed25519) and getIsStorageAdmin(address) on the storage registry SC.
/// Query: ?namespace=...&id=...&min_replication=...  (namespace defaults to "default", id optional, min_replication 1–32 default 1)
pub async fn upload(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let mut uploader_address: Option<String> = None;

    // Optional: verify Massa signature and storage admin
    if let Some(ref auth) = state.upload_auth {
        let massa_address = match headers.get("x-massa-address").and_then(|v| v.to_str().ok()) {
            Some(s) => s.trim().to_string(),
            None => {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({ "error": "missing x-massa-address header" })),
                )
                    .into_response()
            }
        };
        let signature = match headers.get("x-massa-signature").and_then(|v| v.to_str().ok()) {
            Some(s) => s.trim().to_string(),
            None => {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({ "error": "missing x-massa-signature header" })),
                )
                    .into_response()
            }
        };
        let public_key = match headers.get("x-massa-public-key").and_then(|v| v.to_str().ok()) {
            Some(s) => s.trim().to_string(),
            None => {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({ "error": "missing x-massa-public-key header" })),
                )
                    .into_response()
            }
        };

        if let Err(e) = verify_upload_signature(&body, &massa_address, &signature, &public_key) {
            tracing::warn!(error = %e, "upload signature verification failed");
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }

        match get_is_allowed_uploader(
            &auth.massa_json_rpc,
            &auth.storage_registry_address,
            &massa_address,
        )
        .await
        {
            Ok(true) => {}
            Ok(false) => {
                return (
                    StatusCode::FORBIDDEN,
                    Json(serde_json::json!({
                        "error": "address is not an allowed uploader; register via registerAsUploader (pay fee) or be added as storage admin"
                    })),
                )
                    .into_response()
            }
            Err(e) => {
                tracing::warn!(error = %e, "getIsAllowedUploader RPC failed");
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(serde_json::json!({ "error": format!("storage registry check failed: {}", e) })),
                )
                    .into_response();
            }
        }
        uploader_address = Some(massa_address);
    }

    let namespace = query
        .namespace
        .as_deref()
        .unwrap_or("default")
        .to_string();
    let id_hint = query.id.as_deref();
    let min_replication_param = query.min_replication.or_else(|| {
        headers
            .get("x-min-replication")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u8>().ok())
    });
    let min_replication = match min_replication_param {
        Some(n) if (MIN_REPLICATION_MIN..=MIN_REPLICATION_MAX).contains(&n) => n,
        Some(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("min_replication must be between {} and {}", MIN_REPLICATION_MIN, MIN_REPLICATION_MAX)
                })),
            )
                .into_response()
        }
        None => MIN_REPLICATION_MIN,
    };

    match state
        .storage
        .put(&namespace, id_hint, &body, min_replication, uploader_address.clone())
    {
        Ok(id) => {
            tracing::info!(namespace, id, size = body.len(), min_replication, "upload stored");

            // Update total storage usage on the contract when we have an uploader and gRPC client
            if let (Some(ref uploader), Some(ref client)) =
                (uploader_address.as_ref(), state.massa_client.as_ref())
            {
                let size = body.len() as u64;
                if size > 0 {
                    if let Err(e) = client
                        .record_file_upload(uploader, size)
                        .await
                    {
                        tracing::warn!(
                            error = %e,
                            uploader = %uploader,
                            size = size,
                            "failed to record file upload on contract (file was stored)"
                        );
                    }
                }
            }

            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": id,
                    "namespace": namespace,
                    "min_replication": min_replication
                })),
            )
                .into_response()
        }
        Err(e) => {
            let msg = e.to_string();
            let status = if msg.contains("storage limit exceeded") {
                StatusCode::INSUFFICIENT_STORAGE // 507
            } else {
                StatusCode::BAD_REQUEST
            };
            tracing::warn!(error = %e, "upload failed");
            (status, Json(serde_json::json!({ "error": msg }))).into_response()
        }
    }
}

/// GET /data
/// Query: ?namespace=...  (optional; if omitted, list all namespaces)
/// Returns JSON array of { id, namespace, size, created_at }.
pub async fn list(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListQuery>,
) -> impl IntoResponse {
    let namespace = query.namespace.as_deref();

    match state.storage.list(namespace) {
        Ok(entries) => (StatusCode::OK, Json(entries)).into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "list failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response()
        }
    }
}

fn binary_response(status: StatusCode, data: Vec<u8>) -> axum::response::Response {
    let mut res = (status, data).into_response();
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/octet-stream"),
    );
    res
}

/// GET /data/:namespace/:id  — get by namespace and id (path)
pub async fn get_by_namespace_id(
    State(state): State<Arc<AppState>>,
    Path((namespace, id)): Path<(String, String)>,
) -> impl IntoResponse {
    match state.storage.get(&namespace, &id) {
        Ok(data) => binary_response(StatusCode::OK, data),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            binary_response(StatusCode::NOT_FOUND, Vec::new())
        }
        Err(e) => {
            tracing::warn!(error = %e, "get failed");
            binary_response(StatusCode::INTERNAL_SERVER_ERROR, Vec::new())
        }
    }
}

/// GET /data/:id
/// Single path segment: treat as id, use default namespace "default".
pub async fn get_by_id(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.storage.get("default", &id) {
        Ok(data) => binary_response(StatusCode::OK, data),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            binary_response(StatusCode::NOT_FOUND, Vec::new())
        }
        Err(e) => {
            tracing::warn!(error = %e, "get failed");
            binary_response(StatusCode::INTERNAL_SERVER_ERROR, Vec::new())
        }
    }
}

/// Health check.
pub async fn health() -> &'static str {
    "ok"
}

/// P2P peer info response
#[derive(Debug, serde::Serialize)]
pub struct PeersResponse {
    pub local_peer_id: String,
    pub listen_addrs: Vec<String>,
    /// Full multiaddrs with peer ID (for contract registration)
    pub multiaddrs: Vec<String>,
    pub connected_peers: Vec<crate::p2p::PeerInfo>,
}

/// GET /peers — list connected P2P peers
pub async fn peers(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match &state.p2p_state {
        Some(p2p) => {
            let s = p2p.read().await;
            let peer_id = s.local_peer_id.to_string();
            let response = PeersResponse {
                local_peer_id: peer_id.clone(),
                listen_addrs: s.listen_addrs.iter().map(|a| a.to_string()).collect(),
                multiaddrs: s
                    .listen_addrs
                    .iter()
                    .map(|a| format!("{}/p2p/{}", a, peer_id))
                    .collect(),
                connected_peers: s.connected_peers.values().cloned().collect(),
            };
            (StatusCode::OK, Json(response)).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "P2P not enabled" })),
        )
            .into_response(),
    }
}

/// Storage limit and usage (for external clients).
#[derive(Debug, serde::Serialize)]
pub struct StorageConfigResponse {
    /// Storage limit in GB (from STORAGE_LIMIT_GB).
    pub storage_limit_gb: u64,
    /// Storage limit in bytes.
    pub storage_limit_bytes: u64,
    /// Current total size of stored data in bytes.
    pub storage_used_bytes: u64,
    /// P2P listen address (multiaddr) for provider metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p2p_listen_addr: Option<String>,
}

/// GET /config — storage limit and current usage (available from the outside world).
pub async fn storage_config(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let limit_bytes = state.storage.storage_limit_bytes();
    let storage_limit_gb = limit_bytes / (1024 * 1024 * 1024);
    match state.storage.total_size() {
        Ok(used) => {
            // Get discovered P2P addresses (already filtered to exclude localhost)
            let p2p_addrs = state.p2p_listen_addrs.read().unwrap();
            let p2p_addr = if p2p_addrs.is_empty() {
                None
            } else {
                // Return the first non-localhost address, or join all if multiple
                Some(p2p_addrs.join(","))
            };
            
            (
                StatusCode::OK,
                Json(StorageConfigResponse {
                    storage_limit_gb,
                    storage_limit_bytes: limit_bytes,
                    storage_used_bytes: used,
                    p2p_listen_addr: p2p_addr,
                }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "failed to compute storage usage");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
            .into_response()
        }
    }
}

pub fn router(
    storage: Storage,
    upload_auth: Option<UploadAuthConfig>,
    p2p_listen_addrs: Arc<std::sync::RwLock<Vec<String>>>,
    p2p_state: Option<SharedP2pState>,
    massa_client: Option<Arc<MassaClient>>,
) -> Router {
    let state = Arc::new(AppState {
        storage,
        upload_auth,
        p2p_listen_addrs,
        p2p_state,
        massa_client,
    });
    Router::new()
        .route("/health", get(health))
        .route("/config", get(storage_config))
        .route("/peers", get(peers))
        .route("/upload", post(upload))
        .route("/data", get(list))
        .route("/data/{id}", get(get_by_id))
        .route("/data/{namespace}/{id}", get(get_by_namespace_id))
        .with_state(state)
}

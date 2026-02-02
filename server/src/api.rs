//! HTTP API: upload and read endpoints.

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;

use crate::storage::{IndexEntry, Storage};

#[derive(Clone)]
pub struct AppState {
    pub storage: Storage,
}

/// Query for list: optional namespace filter.
#[derive(Debug, serde::Deserialize)]
pub struct ListQuery {
    pub namespace: Option<String>,
}

/// Upload: optional headers for namespace and id (handled in handler via headers or query).
#[derive(Debug, serde::Deserialize)]
pub struct UploadQuery {
    pub namespace: Option<String>,
    pub id: Option<String>,
}

/// POST /upload
/// Body: raw binary data.
/// Query: ?namespace=...&id=...  (namespace defaults to "default", id is optional — server generates UUID)
/// Or headers: X-Namespace, X-Id (optional)
pub async fn upload(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UploadQuery>,
    body: Bytes,
) -> impl IntoResponse {
    let namespace = query
        .namespace
        .as_deref()
        .unwrap_or("default")
        .to_string();
    let id_hint = query.id.as_deref();

    match state.storage.put(&namespace, id_hint, &body) {
        Ok(id) => {
            tracing::info!(namespace, id, size = body.len(), "upload stored");
            (StatusCode::CREATED, Json(serde_json::json!({ "id": id, "namespace": namespace })))
                .into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "upload failed");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response()
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

pub fn router(storage: Storage) -> Router {
    let state = Arc::new(AppState { storage });
    Router::new()
        .route("/health", get(health))
        .route("/upload", post(upload))
        .route("/data", get(list))
        .route("/data/:id", get(get_by_id))
        .route("/data/:namespace/:id", get(get_by_namespace_id))
        .with_state(state)
}

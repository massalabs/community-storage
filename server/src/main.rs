//! Massa storage server — simple upload and read API with filesystem storage.
//! See plan.md and server/README.md.

use std::sync::Arc;

use tower_http::cors::{Any, CorsLayer};

mod api;
mod config;
mod storage;

use api::router;
use config::Config;
use storage::Storage;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env();
    std::fs::create_dir_all(&config.storage_path)?;
    let storage = Storage::new(config.storage_path.clone());

    let app = router(storage).layer(
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any),
    );

    let listener = tokio::net::TcpListener::bind(&config.bind_address).await?;
    tracing::info!("storage server listening on http://{}", config.bind_address);
    axum::serve(listener, app).await?;
    Ok(())
}

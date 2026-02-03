//! Massa storage server — simple upload and read API with filesystem storage.
//! See plan.md and server/README.md.

use tower_http::cors::{Any, CorsLayer};

mod api;
mod config;
mod p2p;
mod storage;

use api::router;
use config::Config;
use storage::Storage;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Load environment from `.env` if present so Config::from_env can
    // work with a simple .env file during development.
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env();
    std::fs::create_dir_all(&config.storage_path)?;
    let storage = Storage::new(config.storage_path.clone());

    if let Some(addr) = &config.massa_address {
        tracing::info!(massa_address = %addr, "storage server Massa address configured");
    } else {
        tracing::warn!("MASSA_ADDRESS not set; storage provider identity is unknown");
    }

    // Always start libp2p node in the background.
    // This will later handle chunk announce/request/challenge protocols
    // between storage servers.
    tracing::info!(
        listen_addr = %config.p2p_listen_addr,
        "starting libp2p P2P subsystem"
    );
    p2p::spawn(config.p2p_listen_addr.clone(), config.massa_address.clone());

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

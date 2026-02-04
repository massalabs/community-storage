//! Massa storage server — simple upload and read API with filesystem storage.
//! See plan.md and server/README.md.

use tower_http::cors::{Any, CorsLayer};

mod api;
mod auth;
mod config;
mod p2p;
mod sc_client;
mod storage;

use api::{router, UploadAuthConfig};
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
    let storage_limit_bytes = config.storage_limit_gb.saturating_mul(1024 * 1024 * 1024);
    let storage = Storage::new(config.storage_path.clone(), storage_limit_bytes);

    tracing::info!(
        storage_limit_gb = config.storage_limit_gb,
        "storage size limit configured"
    );

    // Log metadata required to register this provider in the storage registry (register-provider.ts / .env).
    let provider_endpoint = format!("http://{}", config.bind_address);
    tracing::info!(
        "provider registry metadata (for register-provider.ts): MASSA_ADDRESS={} PROVIDER_ENDPOINT={} PROVIDER_P2P_ADDRS=(see P2P logs when listening)",
        config.massa_address.as_deref().unwrap_or("(set MASSA_ADDRESS)"),
        provider_endpoint,
    );
    if config.massa_address.is_none() {
        tracing::warn!("MASSA_ADDRESS not set; set it to register this provider in the registry");
    }

    // Always start libp2p node in the background.
    // This will later handle chunk announce/request/challenge protocols
    // between storage servers.
    tracing::info!(
        listen_addr = %config.p2p_listen_addr,
        "starting libp2p P2P subsystem"
    );
    p2p::spawn(config.p2p_listen_addr.clone(), config.massa_address.clone());

    // Upload authentication is mandatory: server refuses to start if
    // STORAGE_REGISTRY_ADDRESS or MASSA_JSON_RPC are missing (see Config::from_env).
    tracing::info!(
        registry = %config.storage_registry_address,
        rpc = %config.massa_json_rpc,
        "upload authentication enabled (Massa signature + getIsAllowedUploader)"
    );
    let upload_auth = Some(UploadAuthConfig {
        storage_registry_address: config.storage_registry_address.clone(),
        massa_json_rpc: config.massa_json_rpc.clone(),
    });

    let app = router(storage, upload_auth).layer(
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

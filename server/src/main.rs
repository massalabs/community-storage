//! Massa storage server — simple upload and read API with filesystem storage.

use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

mod api;
mod auth;
mod args;
mod config;
mod contract;
mod p2p;
mod sc_client;
mod storage;

use api::{router, UploadAuthConfig};
use config::Config;
use contract::MassaClient;
use storage::Storage;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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
        "storage configured"
    );

    // Log metadata required to register this provider in the storage registry (register-provider.ts / .env).
    let provider_endpoint = format!("http://{}", config.bind_address);
    tracing::info!(
        "provider registry metadata (for register-provider.ts): MASSA_ADDRESS={} PROVIDER_ENDPOINT={}",
        config.massa_address.as_deref().unwrap_or("(set MASSA_ADDRESS)"),
        provider_endpoint,
    );
    if config.massa_address.is_none() {
        tracing::warn!("MASSA_ADDRESS not set; set it to register this provider in the registry");
    }

    // Shared state for discovered P2P addresses (filtered to exclude localhost)
    let p2p_discovered_addrs = Arc::new(std::sync::RwLock::new(Vec::new()));

    // Discover peers from smart contract
    let mut peers_to_dial = config.bootstrap_peers.clone();

    if !config.contract_address.is_empty() {
        tracing::info!(
            contract = %config.contract_address,
            rpc = %config.massa_json_rpc,
            "querying contract for peers"
        );

        let client = MassaClient::new(
            config.massa_json_rpc.clone(),
            config.contract_address.clone(),
        );

        match client.get_all_providers().await {
            Ok(providers) => {
                for provider in &providers {
                    // Skip self
                    if config.massa_address.as_ref() == Some(&provider.address) {
                        continue;
                    }
                    // Add p2p addresses
                    for addr in &provider.p2p_addrs {
                        if !addr.is_empty() && !peers_to_dial.contains(addr) {
                            tracing::info!(
                                provider = %provider.address,
                                p2p_addr = %addr,
                                "discovered peer from contract"
                            );
                            peers_to_dial.push(addr.clone());
                        }
                    }
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, "failed to query contract for peers");
            }
        }
    }

    // Start libp2p
    tracing::info!(
        listen_addr = %config.p2p_listen_addr,
        peers_count = peers_to_dial.len(),
        "starting libp2p"
    );
    let p2p_state = p2p::spawn(
        config.p2p_listen_addr.clone(),
        config.massa_address.clone(),
        peers_to_dial,
        p2p_discovered_addrs.clone(),
    );

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

    // Start HTTP server
    let app = router(storage, upload_auth, p2p_discovered_addrs, Some(p2p_state)).layer(
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any),
    );

    let listener = tokio::net::TcpListener::bind(&config.bind_address).await?;
    tracing::info!("HTTP server on http://{}", config.bind_address);
    axum::serve(listener, app).await?;
    Ok(())
}

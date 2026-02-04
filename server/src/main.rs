//! Massa storage server — simple upload and read API with filesystem storage.

use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

mod api;
mod auth;
mod args;
mod config;
mod contract;
mod massa_grpc;
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
    // Create Massa client (with gRPC for writes if private key is provided)
    let massa_client = if let (Some(grpc_url), Some(private_key)) =
        (&config.massa_grpc_url, &config.private_key)
    {
        tracing::info!("gRPC client enabled for contract writes");
        match MassaClient::with_grpc(
            config.massa_json_rpc.clone(),
            grpc_url.clone(),
            config.contract_address.clone(),
            private_key,
        )
        .await
        {
            Ok(client) => Some(client),
            Err(e) => {
                tracing::warn!(error = %e, "failed to create gRPC client, writes disabled");
                None
            }
        }
    } else {
        None
    };

    // Fallback to read-only client if gRPC not configured
    let massa_client = massa_client.unwrap_or_else(|| {
        MassaClient::new(config.massa_json_rpc.clone(), config.contract_address.clone())
    });

    // Discover peers from smart contract
    let mut peers_to_dial = config.bootstrap_peers.clone();
    if !config.contract_address.is_empty() {
        tracing::info!(
            contract = %config.contract_address,
            rpc = %config.massa_json_rpc,
            "querying contract for peers"
        );
        match massa_client.get_all_providers().await {
            Ok(providers) => {
                for provider in providers {
                    if config.massa_address.as_ref() == Some(&provider.address) {
                        continue;
                    }
                    for addr in provider.p2p_addrs {
                        if !addr.is_empty() && !peers_to_dial.contains(&addr) {
                            peers_to_dial.push(addr);
                        }
                    }
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, "failed to query contract for peers");
            }
        }
    }

    // Start libp2p (bootstrap peers + initial contract discovery)
    tracing::info!(
        listen_addr = %config.p2p_listen_addr,
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
    // Periodic peer discovery from smart contract
    if !config.contract_address.is_empty() {
        let p2p_state_discovery = p2p_state.clone();
        let massa_address = config.massa_address.clone();
        let rpc_url = config.massa_json_rpc.clone();
        let contract_address = config.contract_address.clone();

        tokio::spawn(async move {
            let client = MassaClient::new(rpc_url, contract_address.clone());
            let mut known_addrs: std::collections::HashSet<String> = std::collections::HashSet::new();

            loop {
                tracing::debug!(contract = %contract_address, "discovering peers from contract");

                match client.get_all_providers().await {
                    Ok(providers) => {
                        for provider in &providers {
                            // Skip self
                            if massa_address.as_ref() == Some(&provider.address) {
                                continue;
                            }
                            // Dial new p2p addresses
                            for addr in &provider.p2p_addrs {
                                if !addr.is_empty() && !known_addrs.contains(addr) {
                                    tracing::info!(
                                        provider = %provider.address,
                                        p2p_addr = %addr,
                                        "discovered peer from contract"
                                    );
                                    known_addrs.insert(addr.clone());

                                    let p2p = p2p_state_discovery.read().await;
                                    if let Err(e) = p2p.dial(addr).await {
                                        tracing::warn!(error = %e, "failed to send dial command");
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "failed to query contract for peers");
                    }
                }

                // Wait before next discovery (30 seconds)
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });
    }

    // Register P2P addresses in smart contract (if gRPC enabled)
    if config.private_key.is_some() && config.massa_grpc_url.is_some() {
        let p2p_state_clone = p2p_state.clone();
        let public_endpoint = config.public_endpoint.clone().unwrap_or_default();
        tokio::spawn(async move {
            // Wait for P2P to get its addresses with exponential backoff
            let mut backoff = std::time::Duration::from_millis(500);
            let max_backoff = std::time::Duration::from_secs(8);
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(60);
            let mut multiaddrs: Vec<String> = Vec::new();

            loop {
                let p2p = p2p_state_clone.read().await;
                let peer_id = p2p.local_peer_id.to_string();
                multiaddrs = p2p
                    .listen_addrs
                    .iter()
                    .map(|a| format!("{}/p2p/{}", a, peer_id))
                    .collect();
                drop(p2p);

                if !multiaddrs.is_empty() {
                    break;
                }

                if tokio::time::Instant::now() >= deadline {
                    tracing::warn!(
                        "timed out waiting for P2P addresses; skipping registration"
                    );
                    return;
                }

                tracing::debug!(?backoff, "waiting for P2P addresses");
                tokio::time::sleep(backoff).await;
                backoff = std::cmp::min(backoff * 2, max_backoff);
            }

            tracing::info!(
                addrs = ?multiaddrs,
                endpoint = %public_endpoint,
                "registering P2P addresses in contract"
            );

            match massa_client
                .update_provider_metadata(&public_endpoint, &multiaddrs)
                .await
            {
                Ok(op_id) => {
                    tracing::info!(operation = %op_id, "P2P addresses registered");
                }
                Err(e) => {
                    tracing::error!(error = %e, "failed to register P2P addresses");
                }
            }
        });
    }

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

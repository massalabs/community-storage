//! Massa storage server — simple upload and read API with filesystem storage.

use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

/// Returns true if the endpoint is local/unreachable (0.0.0.0, 127.0.0.1, localhost).
fn is_local_endpoint(endpoint: &str) -> bool {
    let lower = endpoint.to_lowercase();
    lower.contains("0.0.0.0") || lower.contains("127.0.0.1") || lower.contains("localhost")
}

/// Tries to get a reachable endpoint for the local network (e.g. http://192.168.0.4:4343)
/// when binding to 0.0.0.0. Uses a UDP "connect" to discover the local IP. Port is taken from bind_address.
fn try_local_network_endpoint(bind_address: &str) -> Option<String> {
    let port = bind_address
        .rsplit(':')
        .next()
        .unwrap_or("4343")
        .trim();
    let ip = (|| {
        let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        socket.connect("8.8.8.8:80").ok()?;
        let addr = socket.local_addr().ok()?;
        let ip = addr.ip();
        if ip.is_loopback() {
            return None;
        }
        Some(ip)
    })()?;
    Some(format!("http://{}:{}", ip, port))
}

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

    // Log provider identity (address derived from PRIVATE_KEY).
    let provider_endpoint = format!("http://{}", config.bind_address);
    tracing::info!(
        address = %config.massa_address,
        endpoint = %provider_endpoint,
        "provider identity (from PRIVATE_KEY)"
    );

    // Shared state for discovered P2P addresses (filtered to exclude localhost)
    let p2p_discovered_addrs = Arc::new(std::sync::RwLock::new(Vec::new()));
    // Create Massa client (with gRPC for write operations when MASSA_GRPC_URL is set)
    let massa_client = if let Some(grpc_url) = &config.massa_grpc_url
    {
        tracing::info!("gRPC client enabled for contract writes");
        match MassaClient::with_grpc(
            config.massa_json_rpc.clone(),
            grpc_url.clone(),
            config.storage_registry_address.clone(),
            &config.private_key,
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
    let massa_client = Arc::new(massa_client.unwrap_or_else(|| {
        MassaClient::new(config.massa_json_rpc.clone(), config.storage_registry_address.clone())
    }));

    // Discover peers from smart contract
    let mut peers_to_dial = config.bootstrap_peers.clone();
    tracing::info!(
        contract = %config.storage_registry_address,
        rpc = %config.massa_json_rpc,
        "querying contract for peers"
    );
    match massa_client.get_all_providers().await {
            Ok(providers) => {
                for provider in providers {
                    if config.massa_address == provider.address {
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
    {
        let p2p_state_discovery = p2p_state.clone();
        let massa_address = config.massa_address.clone();
        let rpc_url = config.massa_json_rpc.clone();
        let storage_registry_address = config.storage_registry_address.clone();

        tokio::spawn(async move {
            let client = MassaClient::new(rpc_url, storage_registry_address.clone());
            let mut known_addrs: std::collections::HashSet<String> = std::collections::HashSet::new();

            loop {
                tracing::debug!(contract = %storage_registry_address, "discovering peers from contract");

                match client.get_all_providers().await {
                    Ok(providers) => {
                        for provider in &providers {
                            // Skip self
                            if massa_address == provider.address {
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

    // Register as storage node and publish P2P/endpoint in smart contract (if gRPC enabled)
    if config.massa_grpc_url.is_some() {
        let p2p_state_clone = p2p_state.clone();
        let public_endpoint = config.public_endpoint.clone();
        // When binding to 0.0.0.0 (or other local endpoint), use local network IP for contract if discoverable
        let endpoint_for_contract = if is_local_endpoint(&public_endpoint) {
            match try_local_network_endpoint(&config.bind_address) {
                Some(discovered) => {
                    tracing::info!(
                        bind = %config.bind_address,
                        endpoint = %discovered,
                        "endpoint is local; using discovered local network IP for contract"
                    );
                    discovered
                }
                None => {
                    tracing::info!(
                        endpoint = %public_endpoint,
                        "endpoint is local (0.0.0.0 / 127.0.0.1 / localhost); could not discover local network IP; not storing endpoint in contract metadata"
                    );
                    String::new()
                }
            }
        } else {
            public_endpoint.clone()
        };
        let massa_client_reg = massa_client.clone();
        let massa_address = config.massa_address.clone();
        let storage_limit_gb = config.storage_limit_gb;
        tokio::spawn(async move {
            // Wait for P2P to get its addresses with exponential backoff
            let mut backoff = std::time::Duration::from_millis(500);
            let max_backoff = std::time::Duration::from_secs(8);
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(60);

            let multiaddrs = loop {
                let p2p = p2p_state_clone.read().await;
                let peer_id = p2p.local_peer_id.to_string();
                let addrs: Vec<String> = p2p
                    .listen_addrs
                    .iter()
                    .map(|a| format!("{}/p2p/{}", a, peer_id))
                    .collect();
                drop(p2p);

                if !addrs.is_empty() {
                    break addrs;
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
            };

            let registered = match massa_client_reg.is_node_registered(&massa_address).await {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!(
                        error = %e,
                        "failed to check if node is registered; skipping registration"
                    );
                    return;
                }
            };

            if !registered {
                tracing::info!(
                    allocated_gb = storage_limit_gb,
                    endpoint = %endpoint_for_contract,
                    "node not yet registered; calling registerStorageNode"
                );
                match massa_client_reg
                    .register_storage_node(storage_limit_gb, &endpoint_for_contract, &multiaddrs)
                    .await
                {
                    Ok(op_id) => {
                        tracing::info!(
                            operation_id = %op_id,
                            "provider registration succeeded (registerStorageNode sent)"
                        );
                    }
                    Err(e) => {
                        tracing::error!(
                            error = %e,
                            "provider registration failed (registerStorageNode)"
                        );
                    }
                }
            } else {
                // Already registered: update metadata only if it changed
                let metadata_needs_update = match massa_client_reg
                    .get_provider_metadata(&massa_address)
                    .await
                {
                    Ok(current) => {
                        let endpoint_diff = current.endpoint != endpoint_for_contract;
                        let current_p2p: std::collections::HashSet<_> =
                            current.p2p_addrs.iter().collect();
                        let wanted_p2p: std::collections::HashSet<_> =
                            multiaddrs.iter().collect();
                        let p2p_diff = current_p2p != wanted_p2p;
                        endpoint_diff || p2p_diff
                    }
                    Err(_) => true, // could not read current metadata, assume update needed
                };

                if !metadata_needs_update {
                    tracing::info!(
                        "node already registered; provider metadata unchanged, skipping update"
                    );
                } else {
                    tracing::info!(
                        addrs = ?multiaddrs,
                        endpoint = %endpoint_for_contract,
                        "node already registered; updating P2P addresses and endpoint"
                    );
                    match massa_client_reg
                        .update_provider_metadata(&endpoint_for_contract, &multiaddrs)
                        .await
                    {
                        Ok(op_id) => {
                            tracing::info!(
                                operation_id = %op_id,
                                endpoint = %endpoint_for_contract,
                                "provider metadata update succeeded"
                            );
                        }
                        Err(e) => {
                            tracing::error!(
                                error = %e,
                                endpoint = %endpoint_for_contract,
                                "provider metadata update failed"
                            );
                        }
                    }
                }
            }
        });
    }

    // Start HTTP server
    let app = router(
        storage,
        upload_auth,
        p2p_discovered_addrs,
        Some(p2p_state),
        Some(massa_client),
    )
    .layer(
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

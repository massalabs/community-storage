//! Simple libp2p node for the storage server.
//!
//! For now this just:
//! - creates a libp2p identity
//! - starts a Swarm with a basic ping behaviour
//! - listens on the configured multiaddr
//! - logs its PeerId and listen addresses
//!
//! This follows the official libp2p ping tutorial for 0.56.0 and can later
//! be extended with custom storage protocols (chunk announce / request /
//! response, challenges, etc.).

use std::time::Duration;

use futures::StreamExt;
use libp2p::{
    noise, ping,
    swarm::{SwarmEvent},
    tcp,
    yamux, Multiaddr, SwarmBuilder,
};

/// Spawn the libp2p node in a background task.
///
/// - `listen_addr`: libp2p multiaddr to listen on (e.g. `/ip4/0.0.0.0/tcp/0`)
/// - `massa_address`: optional Massa address identifying this storage provider
pub fn spawn(listen_addr: String, massa_address: Option<String>) {
    tokio::spawn(async move {
        if let Err(e) = run(&listen_addr, massa_address.as_deref()).await {
            tracing::error!(error = %e, "p2p task failed");
        }
    });
}

async fn run(
    listen_addr: &str,
    massa_address: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Build a swarm following the official ping tutorial:
    // - new identity
    // - Tokio runtime
    // - TCP + Noise + Yamux
    // - ping behaviour
    // - idle timeout disabled so we can observe pings indefinitely
    let mut swarm = SwarmBuilder::with_new_identity()
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_behaviour(|_| ping::Behaviour::default())?
        .with_swarm_config(|cfg| {
            cfg.with_idle_connection_timeout(Duration::from_secs(u64::MAX))
        })
        .build();

    let local_peer_id = *swarm.local_peer_id();
    tracing::info!(
        %local_peer_id,
        massa_address = massa_address.unwrap_or("unknown"),
        "starting libp2p node"
    );

    // Listen on configured address.
    let addr: Multiaddr = listen_addr.parse()?;
    swarm.listen_on(addr)?;

    // Collect listen addresses for registry metadata (PROVIDER_P2P_ADDRS).
    let mut listen_addrs: Vec<Multiaddr> = Vec::new();

    // Main event loop. For now we just log key events.
    loop {
        match swarm.select_next_some().await {
            SwarmEvent::NewListenAddr { address, .. } => {
                listen_addrs.push(address.clone());
                let addrs_str = listen_addrs
                    .iter()
                    .map(|a| a.to_string())
                    .collect::<Vec<_>>()
                    .join(",");
                tracing::info!(
                    %address,
                    "libp2p listening on; provider registry metadata: PROVIDER_P2P_ADDRS={}",
                    addrs_str,
                );
            }
            SwarmEvent::Behaviour(event) => {
                tracing::debug!(?event, "libp2p behaviour event");
            }
            _ => {
                // For now we ignore other events.
            }
        }
    }
}


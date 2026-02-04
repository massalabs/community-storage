//! LibP2P node for storage server peer discovery and communication.
//!
//! Features:
//! - QUIC transport (primary) with TCP fallback
//! - Peer discovery via smart contract registry
//! - Ping for connectivity testing
//! - Identify protocol for peer info exchange
//! - Track connected peers

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use std::time::Duration;

use futures::StreamExt;
use libp2p::{
    identify, noise, ping,
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, SwarmBuilder,
};
use tokio::sync::RwLock;

/// Combined network behaviour
#[derive(NetworkBehaviour)]
struct Behaviour {
    ping: ping::Behaviour,
    identify: identify::Behaviour,
}

/// Connected peer info
#[derive(Debug, Clone, serde::Serialize)]
pub struct PeerInfo {
    pub peer_id: String,
    pub addresses: Vec<String>,
    pub agent_version: Option<String>,
}

/// Shared state for peer tracking
pub struct P2pState {
    pub local_peer_id: PeerId,
    pub listen_addrs: Vec<Multiaddr>,
    pub connected_peers: HashMap<PeerId, PeerInfo>,
}

impl P2pState {
    pub fn new(peer_id: PeerId) -> Self {
        Self {
            local_peer_id: peer_id,
            listen_addrs: Vec::new(),
            connected_peers: HashMap::new(),
        }
    }
}

pub type SharedP2pState = Arc<RwLock<P2pState>>;

/// Check if a multiaddr contains a localhost address (0.0.0.0 or 127.0.0.1).
fn is_localhost_multiaddr(addr: &str) -> bool {
    addr.contains("/ip4/0.0.0.0/") || addr.contains("/ip4/127.0.0.1/")
}

/// Spawn the libp2p node in a background task.
pub fn spawn(
    listen_addr: String,
    massa_address: Option<String>,
    peers_to_dial: Vec<String>,
    discovered_addrs: Arc<StdRwLock<Vec<String>>>,
) -> SharedP2pState {
    let (state, peer_id) = {
        // We need to create identity first to get PeerId for state
        let keypair = libp2p::identity::Keypair::generate_ed25519();
        let peer_id = keypair.public().to_peer_id();
        let state = Arc::new(RwLock::new(P2pState::new(peer_id)));
        (state.clone(), keypair)
    };

    let state_clone = state.clone();
    tokio::spawn(async move {
        if let Err(e) = run(
            &listen_addr,
            massa_address.as_deref(),
            peers_to_dial,
            peer_id,
            state_clone,
            discovered_addrs,
        )
        .await
        {
            tracing::error!(error = %e, "p2p task failed");
        }
    });

    state
}

async fn run(
    listen_addr: &str,
    massa_address: Option<&str>,
    peers_to_dial: Vec<String>,
    keypair: libp2p::identity::Keypair,
    state: SharedP2pState,
    discovered_addrs: Arc<StdRwLock<Vec<String>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let local_peer_id = keypair.public().to_peer_id();

    // Build swarm with TCP + QUIC transports
    let mut swarm = SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_quic()
        .with_behaviour(|key| Behaviour {
            ping: ping::Behaviour::default(),
            identify: identify::Behaviour::new(identify::Config::new(
                "/massa-storage/1.0.0".to_string(),
                key.public(),
            )),
        })?
        .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    tracing::info!(
        %local_peer_id,
        massa_address = massa_address.unwrap_or("unknown"),
        "starting libp2p node"
    );

    // Listen on both QUIC and TCP
    // Parse base address (e.g., /ip4/0.0.0.0/udp/4001 -> extract IP and port)
    let addr: Multiaddr = listen_addr.parse()?;

    // Try to listen on QUIC (UDP) first
    let quic_addr = listen_addr.replace("/tcp/", "/udp/").replace("/tcp", "/udp") + "/quic-v1";
    if let Ok(quic_multiaddr) = quic_addr.parse::<Multiaddr>() {
        match swarm.listen_on(quic_multiaddr.clone()) {
            Ok(_) => tracing::info!(%quic_multiaddr, "listening on QUIC"),
            Err(e) => tracing::warn!(error = %e, "failed to listen on QUIC, using TCP only"),
        }
    }

    // Also listen on TCP as fallback
    swarm.listen_on(addr)?;

    // Dial initial peers
    for peer_addr in &peers_to_dial {
        match peer_addr.parse::<Multiaddr>() {
            Ok(addr) => {
                tracing::info!(%addr, "dialing peer");
                if let Err(e) = swarm.dial(addr.clone()) {
                    tracing::warn!(%addr, error = %e, "failed to dial peer");
                }
            }
            Err(e) => {
                tracing::warn!(addr = %peer_addr, error = %e, "invalid multiaddr");
            }
        }
    }

    // Event loop
    loop {
        match swarm.select_next_some().await {
            SwarmEvent::NewListenAddr { address, .. } => {
                let full_addr = format!("{}/p2p/{}", address, local_peer_id);
                {
                    let mut s = state.write().await;
                    s.listen_addrs.push(address.clone());
                }
                let addr_str = address.to_string();
                if !is_localhost_multiaddr(&addr_str) {
                    let mut addrs = discovered_addrs.write().unwrap();
                    if !addrs.contains(&addr_str) {
                        addrs.push(addr_str.clone());
                    }
                }
                tracing::info!(
                    %address,
                    full_addr = %full_addr,
                    "libp2p listening"
                );
            }

            SwarmEvent::ConnectionEstablished {
                peer_id, endpoint, ..
            } => {
                tracing::info!(
                    %peer_id,
                    address = %endpoint.get_remote_address(),
                    "peer connected"
                );
                let mut s = state.write().await;
                s.connected_peers.insert(
                    peer_id,
                    PeerInfo {
                        peer_id: peer_id.to_string(),
                        addresses: vec![endpoint.get_remote_address().to_string()],
                        agent_version: None,
                    },
                );
            }

            SwarmEvent::ConnectionClosed { peer_id, cause, .. } => {
                tracing::info!(
                    %peer_id,
                    cause = ?cause,
                    "peer disconnected"
                );
                let mut s = state.write().await;
                s.connected_peers.remove(&peer_id);
            }

            SwarmEvent::Behaviour(BehaviourEvent::Identify(identify::Event::Received {
                peer_id,
                info,
                ..
            })) => {
                tracing::info!(
                    %peer_id,
                    agent = %info.agent_version,
                    protocols = ?info.protocols,
                    "identified peer"
                );
                let mut s = state.write().await;
                if let Some(peer_info) = s.connected_peers.get_mut(&peer_id) {
                    peer_info.agent_version = Some(info.agent_version);
                    peer_info.addresses = info.listen_addrs.iter().map(|a| a.to_string()).collect();
                }
            }

            SwarmEvent::Behaviour(BehaviourEvent::Ping(ping::Event { peer, result, .. })) => {
                match result {
                    Ok(rtt) => {
                        tracing::debug!(%peer, rtt_ms = rtt.as_millis(), "ping success");
                    }
                    Err(e) => {
                        tracing::debug!(%peer, error = %e, "ping failed");
                    }
                }
            }

            _ => {}
        }
    }
}

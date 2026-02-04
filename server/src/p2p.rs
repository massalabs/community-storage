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
    multiaddr::Protocol,
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, SwarmBuilder,
};
use tokio::sync::{mpsc, RwLock};

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

/// Command to send to the P2P task
pub enum P2pCommand {
    Dial(String), // Multiaddr to dial
}

/// Shared state for peer tracking
pub struct P2pState {
    pub local_peer_id: PeerId,
    pub listen_addrs: Vec<Multiaddr>,
    pub connected_peers: HashMap<PeerId, PeerInfo>,
    cmd_tx: mpsc::Sender<P2pCommand>,
}

impl P2pState {
    pub fn new(peer_id: PeerId, cmd_tx: mpsc::Sender<P2pCommand>) -> Self {
        Self {
            local_peer_id: peer_id,
            listen_addrs: Vec::new(),
            connected_peers: HashMap::new(),
            cmd_tx,
        }
    }

    /// Dial a new peer by multiaddr
    pub async fn dial(&self, addr: &str) -> Result<(), mpsc::error::SendError<P2pCommand>> {
        self.cmd_tx.send(P2pCommand::Dial(addr.to_string())).await
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
    // Create command channel for dialing new peers
    let (cmd_tx, cmd_rx) = mpsc::channel::<P2pCommand>(32);

    let (state, keypair) = {
        // We need to create identity first to get PeerId for state
        let keypair = libp2p::identity::Keypair::generate_ed25519();
        let peer_id = keypair.public().to_peer_id();
        let state = Arc::new(RwLock::new(P2pState::new(peer_id, cmd_tx)));
        (state.clone(), keypair)
    };

    let state_clone = state.clone();
    tokio::spawn(async move {
        if let Err(e) = run(
            &listen_addr,
            massa_address.as_deref(),
            peers_to_dial,
            keypair,
            state_clone,
            cmd_rx,
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
    mut cmd_rx: mpsc::Receiver<P2pCommand>,
    discovered_addrs: Arc<StdRwLock<Vec<String>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let local_peer_id = keypair.public().to_peer_id();

    // Build swarm with TCP + QUIC transports + DNS resolution
    let mut swarm = SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_quic()
        .with_dns()?
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
    let addr: Multiaddr = listen_addr.parse()?;

    // Try to listen on QUIC (UDP) first, derived from the parsed multiaddr.
    let mut ip_proto: Option<Protocol> = None;
    let mut tcp_port: Option<u16> = None;
    for proto in addr.iter() {
        match proto {
            Protocol::Ip4(_) | Protocol::Ip6(_) => {
                ip_proto = Some(proto);
            }
            Protocol::Tcp(port) => {
                tcp_port = Some(port);
            }
            _ => {}
        }
    }

    if let (Some(ip), Some(port)) = (ip_proto, tcp_port) {
        let mut quic_multiaddr = Multiaddr::empty();
        quic_multiaddr.push(ip);
        quic_multiaddr.push(Protocol::Udp(port));
        quic_multiaddr.push(Protocol::QuicV1);
        tracing::debug!(%quic_multiaddr, "attempting QUIC listen");
        match swarm.listen_on(quic_multiaddr.clone()) {
            Ok(_) => tracing::info!(%quic_multiaddr, "listening on QUIC"),
            Err(e) => tracing::warn!(error = ?e, "failed to listen on QUIC, using TCP only"),
        }
    } else {
        tracing::warn!(
            %listen_addr,
            "cannot derive QUIC listen address (missing ip or tcp port)"
        );
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

    // Event loop - handle both swarm events and dial commands
    loop {
        tokio::select! {
            // Handle dial commands from other tasks
            Some(cmd) = cmd_rx.recv() => {
                match cmd {
                    P2pCommand::Dial(addr_str) => {
                        match addr_str.parse::<Multiaddr>() {
                            Ok(addr) => {
                                tracing::info!(%addr, "dialing peer (from contract)");
                                if let Err(e) = swarm.dial(addr.clone()) {
                                    tracing::warn!(%addr, error = %e, "failed to dial peer");
                                }
                            }
                            Err(e) => {
                                tracing::warn!(addr = %addr_str, error = %e, "invalid multiaddr");
                            }
                        }
                    }
                }
            }

            // Handle swarm events
            event = swarm.select_next_some() => {
                match event {
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
    }
}

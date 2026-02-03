//! Server configuration (storage path, bind address, P2P, Massa address).

use std::path::PathBuf;

/// Storage server configuration.
#[derive(Clone, Debug)]
pub struct Config {
    /// Base directory for storing uploaded data (e.g. `./data`).
    pub storage_path: PathBuf,
    /// Bind address for the HTTP server (e.g. `127.0.0.1:4343`).
    pub bind_address: String,
    /// libp2p listen address (multiaddr), e.g. `/ip4/0.0.0.0/tcp/0`.
    pub p2p_listen_addr: String,
    /// Optional Massa address identifying this storage provider.
    /// Example: `AU1...` (bech32) or any canonical form you use in Massa.
    pub massa_address: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            storage_path: PathBuf::from("./data"),
            bind_address: "127.0.0.1:4343".to_string(),
            p2p_listen_addr: "/ip4/0.0.0.0/tcp/0".to_string(),
            massa_address: None,
        }
    }
}

impl Config {
    /// Create config from environment or defaults.
    /// - `STORAGE_PATH` (optional): base path for data
    /// - `BIND_ADDRESS` (optional): e.g. `127.0.0.1:4343`
    /// - `P2P_LISTEN_ADDR` (optional): libp2p multiaddr (default: `/ip4/0.0.0.0/tcp/0`)
    /// - `MASSA_ADDRESS` (optional): Massa address identifying this storage provider
    pub fn from_env() -> Self {
        let storage_path = std::env::var("STORAGE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));
        let bind_address = std::env::var("BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:4343".to_string());
        let p2p_listen_addr = std::env::var("P2P_LISTEN_ADDR")
            .unwrap_or_else(|_| "/ip4/0.0.0.0/tcp/0".to_string());
        let massa_address = std::env::var("MASSA_ADDRESS").ok();
        Self {
            storage_path,
            bind_address,
            p2p_listen_addr,
            massa_address,
        }
    }
}

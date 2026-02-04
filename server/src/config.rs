//! Server configuration (storage path, bind address, P2P, Massa address).

use std::path::PathBuf;

/// Storage server configuration.
#[derive(Clone, Debug)]
pub struct Config {
    /// Base directory for storing uploaded data (e.g. `./data`).
    pub storage_path: PathBuf,
    /// Bind address for the HTTP server (e.g. `127.0.0.1:4343`).
    pub bind_address: String,
    /// Storage size limit in GB (mandatory). Uploads are rejected when total usage would exceed this.
    pub storage_limit_gb: u64,
    /// libp2p listen address (multiaddr), e.g. `/ip4/0.0.0.0/tcp/0`.
    pub p2p_listen_addr: String,
    /// Optional Massa address identifying this storage provider.
    /// Example: `AU1...` (bech32) or any canonical form you use in Massa.
    pub massa_address: Option<String>,
    /// Storage registry smart contract address (for upload auth: getIsAllowedUploader).
    pub storage_registry_address: String,
    /// Massa JSON-RPC URL (e.g. https://buildnet.massa.net/api/v2). Required for upload auth.
    pub massa_json_rpc: String,
}

impl Config {
    /// Create config from environment.
    /// - `STORAGE_PATH` (optional): base path for data (default: `./data`)
    /// - `BIND_ADDRESS` (optional): e.g. `127.0.0.1:4343`
    /// - `STORAGE_LIMIT_GB` (required): max total storage in GB; uploads rejected when exceeded
    /// - `P2P_LISTEN_ADDR` (optional): libp2p multiaddr (default: `/ip4/0.0.0.0/tcp/0`)
    /// - `MASSA_ADDRESS` (optional): Massa address identifying this storage provider
    /// - `STORAGE_REGISTRY_ADDRESS` (required): SC address for getIsAllowedUploader / getIsStorageAdmin
    /// - `MASSA_JSON_RPC` (required): Massa JSON-RPC URL for read-only SC calls
    pub fn from_env() -> Self {
        let storage_path = std::env::var("STORAGE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));
        let bind_address = std::env::var("BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:4343".to_string());
        let storage_limit_gb = std::env::var("STORAGE_LIMIT_GB")
            .expect("STORAGE_LIMIT_GB is required")
            .parse::<u64>()
            .expect("STORAGE_LIMIT_GB must be a positive integer");
        let p2p_listen_addr = std::env::var("P2P_LISTEN_ADDR")
            .unwrap_or_else(|_| "/ip4/0.0.0.0/tcp/0".to_string());
        let massa_address = std::env::var("MASSA_ADDRESS").ok();
        let storage_registry_address = std::env::var("STORAGE_REGISTRY_ADDRESS")
            .expect("STORAGE_REGISTRY_ADDRESS is required for upload authentication");
        let massa_json_rpc = std::env::var("MASSA_JSON_RPC")
            .expect("MASSA_JSON_RPC is required for upload authentication");
        Self {
            storage_path,
            bind_address,
            storage_limit_gb,
            p2p_listen_addr,
            massa_address,
            storage_registry_address,
            massa_json_rpc,
        }
    }
}

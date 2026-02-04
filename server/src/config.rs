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
    pub massa_address: Option<String>,
    /// Storage registry smart contract address (for upload auth: getIsAllowedUploader).
    pub storage_registry_address: String,
    /// Massa JSON-RPC URL (e.g. https://buildnet.massa.net/api/v2). Required for upload auth.
    pub massa_json_rpc: String,
    /// Bootstrap peers to connect to on startup (comma-separated multiaddrs).
    pub bootstrap_peers: Vec<String>,
    /// Massa gRPC URL for write operations (e.g. `grpc://buildnet.massa.net:33037`).
    pub massa_grpc_url: Option<String>,
    /// Storage registry contract address.
    pub contract_address: String,
    /// Private key for signing transactions (optional, needed for P2P address registration).
    pub private_key: Option<String>,
    /// Public HTTP endpoint for this provider (registered in contract for other peers).
    pub public_endpoint: Option<String>,
}

impl Config {
    /// Create config from environment.
    /// - `STORAGE_PATH` (optional): base path for data (default: `./data`)
    /// - `BIND_ADDRESS` (optional): e.g. `127.0.0.1:4343`
    /// - `STORAGE_LIMIT_GB` (required): max total storage in GB; uploads rejected when exceeded
    /// - `MASSA_ADDRESS` (optional): Massa address identifying this storage provider
    /// - `STORAGE_REGISTRY_ADDRESS` (required): SC address for getIsAllowedUploader / getIsStorageAdmin
    /// - `MASSA_JSON_RPC` (required): Massa JSON-RPC URL for read-only SC calls
    pub fn from_env() -> Self {
        let storage_path = std::env::var("STORAGE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));
        let bind_address = std::env::var("BIND_ADDRESS")
            .unwrap_or_else(|_| "127.0.0.1:4343".to_string());
        let storage_limit_gb = std::env::var("STORAGE_LIMIT_GB")
            .expect("STORAGE_LIMIT_GB is required")
            .parse::<u64>()
            .expect("STORAGE_LIMIT_GB must be a positive integer");
        // P2P listen addr is not configurable via env; value is shown in logs when P2P starts.
        let p2p_listen_addr = "/ip4/0.0.0.0/tcp/0".to_string();
        let massa_address = std::env::var("MASSA_ADDRESS").ok();
        let storage_registry_address = std::env::var("STORAGE_REGISTRY_ADDRESS")
            .expect("STORAGE_REGISTRY_ADDRESS is required for upload authentication");
        let massa_json_rpc = std::env::var("MASSA_JSON_RPC")
            .expect("MASSA_JSON_RPC is required for upload authentication");
        let bootstrap_peers = std::env::var("BOOTSTRAP_PEERS")
            .map(|s| s.split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect())
            .unwrap_or_default();
        let massa_grpc_url = std::env::var("MASSA_GRPC_URL").ok();
        let contract_address = std::env::var("CONTRACT_ADDRESS")
            .unwrap_or_else(|_| "AS14XRdSCc87DZbMx2Zwa1BWK2R8WmwShFGnTtVa2RLDYyx2vwyn".to_string());
        let private_key = std::env::var("PRIVATE_KEY").ok();
        let public_endpoint = std::env::var("PUBLIC_ENDPOINT").ok();

        Self {
            storage_path,
            bind_address,
            storage_limit_gb,
            p2p_listen_addr,
            massa_address,
            storage_registry_address,
            massa_json_rpc,
            bootstrap_peers,
            massa_grpc_url,
            contract_address,
            private_key,
            public_endpoint,
        }
    }
}

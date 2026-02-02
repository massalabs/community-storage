//! Server configuration (storage path, bind address).

use std::path::PathBuf;

/// Storage server configuration.
#[derive(Clone, Debug)]
pub struct Config {
    /// Base directory for storing uploaded data (e.g. `./data`).
    pub storage_path: PathBuf,
    /// Bind address for the HTTP server (e.g. `127.0.0.1:4343`).
    pub bind_address: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            storage_path: PathBuf::from("./data"),
            bind_address: "127.0.0.1:4343".to_string(),
        }
    }
}

impl Config {
    /// Create config from environment or defaults.
    /// - `STORAGE_PATH` (optional): base path for data
    /// - `BIND_ADDRESS` (optional): e.g. `127.0.0.1:4343`
    pub fn from_env() -> Self {
        let storage_path = std::env::var("STORAGE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));
        let bind_address = std::env::var("BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:4343".to_string());
        Self {
            storage_path,
            bind_address,
        }
    }
}

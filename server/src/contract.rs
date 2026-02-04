//! Massa smart contract interaction.
//!
//! - Read-only queries via JSON-RPC
//! - Write operations (updateProviderMetadata) via gRPC

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::args::Args;
use crate::massa_grpc::{ChainId, GrpcClient};
use massa_models::amount::Amount;

/// Provider info from the contract
#[derive(Debug, Clone)]
pub struct ProviderInfo {
    pub address: String,
    pub endpoint: String,
    pub p2p_addrs: Vec<String>,
}

/// Massa client for contract interactions
/// - JSON-RPC for read-only queries
/// - gRPC for write operations (requires private key)
pub struct MassaClient {
    http: reqwest::Client,
    rpc_url: String,
    contract_address: String,
    /// gRPC client for write operations (optional, requires private key)
    grpc_client: Option<Arc<Mutex<GrpcClient>>>,
}

#[derive(Serialize)]
struct JsonRpcRequest<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    params: serde_json::Value,
}

#[derive(Deserialize)]
struct JsonRpcResponse {
    result: Option<serde_json::Value>,
    error: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct ReadOnlyResult {
    result: Option<ReadOnlyResultInner>,
}

#[derive(Deserialize)]
struct ReadOnlyResultInner {
    #[serde(rename = "Ok")]
    ok: Option<Vec<u8>>,
    #[serde(rename = "Error")]
    error: Option<String>,
}

impl MassaClient {
    pub fn new(rpc_url: String, contract_address: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            rpc_url,
            contract_address,
            grpc_client: None,
        }
    }

    /// Create a client with gRPC support for write operations
    pub async fn with_grpc(
        rpc_url: String,
        grpc_url: String,
        contract_address: String,
        private_key: &str,
    ) -> Result<Self> {
        let grpc_client = GrpcClient::new(&grpc_url, private_key, ChainId::Buildnet).await?;

        Ok(Self {
            http: reqwest::Client::new(),
            rpc_url,
            contract_address,
            grpc_client: Some(Arc::new(Mutex::new(grpc_client))),
        })
    }

    /// Call a read-only function on the contract
    async fn read_only_call(&self, function: &str, args: &[u8]) -> Result<Vec<u8>> {
        let params = serde_json::json!([[{
            "target_address": self.contract_address,
            "target_function": function,
            "parameter": args.iter().map(|b| *b as i32).collect::<Vec<_>>(),
            "max_gas": 1_000_000_000u64,
        }]]);

        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id: 1,
            method: "execute_read_only_call",
            params,
        };

        let resp: JsonRpcResponse = self
            .http
            .post(&self.rpc_url)
            .json(&req)
            .send()
            .await?
            .json()
            .await?;

        if let Some(err) = resp.error {
            return Err(anyhow!("RPC error: {:?}", err));
        }

        let result = resp.result.ok_or_else(|| anyhow!("No result"))?;
        let parsed: Vec<ReadOnlyResult> = serde_json::from_value(result)?;

        parsed
            .first()
            .and_then(|r| r.result.as_ref())
            .and_then(|r| r.ok.clone())
            .ok_or_else(|| anyhow!("No result data"))
    }

    /// Call a read-only function; returns None when the contract execution fails (e.g. "Node not found").
    async fn read_only_call_optional(&self, function: &str, args: &[u8]) -> Result<Option<Vec<u8>>> {
        let params = serde_json::json!([[{
            "target_address": self.contract_address,
            "target_function": function,
            "parameter": args.iter().map(|b| *b as i32).collect::<Vec<_>>(),
            "max_gas": 1_000_000_000u64,
        }]]);

        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id: 1,
            method: "execute_read_only_call",
            params,
        };

        let resp: JsonRpcResponse = self
            .http
            .post(&self.rpc_url)
            .json(&req)
            .send()
            .await?
            .json()
            .await?;

        if let Some(err) = resp.error {
            return Err(anyhow!("RPC error: {:?}", err));
        }

        let result = resp.result.ok_or_else(|| anyhow!("No result"))?;
        let parsed: Vec<ReadOnlyResult> = serde_json::from_value(result)?;

        let inner = parsed.first().and_then(|r| r.result.as_ref());
        Ok(inner.and_then(|r| {
            if r.error.is_some() {
                None
            } else {
                r.ok.clone()
            }
        }))
    }

    /// Returns true if the address is already registered as a storage node.
    pub async fn is_node_registered(&self, address: &str) -> Result<bool> {
        let mut request = Args::new();
        request.add_string(address);
        match self
            .read_only_call_optional("getNodeInfo", &request.into_bytes())
            .await?
        {
            Some(data) => Ok(!data.is_empty()),
            None => Ok(false),
        }
    }

    /// Register this address as a storage node (allocated GB, endpoint, P2P addrs).
    /// Call only when gRPC is configured and the node is not yet registered.
    pub async fn register_storage_node(
        &self,
        allocated_gb: u64,
        endpoint: &str,
        p2p_addrs: &[String],
    ) -> Result<String> {
        let grpc = self
            .grpc_client
            .as_ref()
            .ok_or_else(|| anyhow!("gRPC client not configured (cannot register storage node)"))?;

        let mut args = Args::new();
        args.add_u64(allocated_gb);
        args.add_string(endpoint);
        args.add_string_array(p2p_addrs);

        let mut client = grpc.lock().await;
        let op_id = client
            .call_sc(
                &self.contract_address,
                "registerStorageNode",
                args.into_bytes(),
                "0.01",
                10_000_000,
                Amount::from_raw(0),
            )
            .await
            .map_err(|e| anyhow!("Failed to call registerStorageNode: {}", e))?;

        tracing::info!(
            operation_id = %op_id,
            allocated_gb,
            endpoint = %endpoint,
            p2p_addrs_count = p2p_addrs.len(),
            "storage node registration sent"
        );

        Ok(op_id)
    }

    /// Get all registered provider addresses
    pub async fn get_registered_addresses(&self) -> Result<Vec<String>> {
        let data = self.read_only_call("getRegisteredAddressesView", &[]).await?;
        if data.is_empty() {
            return Ok(Vec::new());
        }
        let mut args = Args::from_bytes(data);
        Ok(args.next_string_array()?)
    }

    /// Get provider metadata (endpoint + p2p addrs)
    pub async fn get_provider_metadata(&self, address: &str) -> Result<ProviderInfo> {
        let mut request = Args::new();
        request.add_string(address);

        let data = self.read_only_call("getProviderMetadataView", &request.into_bytes()).await?;

        let mut response = Args::from_bytes(data);
        let endpoint = response.next_string()?;
        let p2p_addrs = response.next_string_array()?;

        Ok(ProviderInfo {
            address: address.to_string(),
            endpoint,
            p2p_addrs,
        })
    }

    /// Get all providers with their metadata
    pub async fn get_all_providers(&self) -> Result<Vec<ProviderInfo>> {
        let addresses = self.get_registered_addresses().await?;
        tracing::info!(count = addresses.len(), "found registered providers");

        let mut providers = Vec::new();
        for addr in addresses {
            match self.get_provider_metadata(&addr).await {
                Ok(info) => {
                    tracing::debug!(
                        address = %addr,
                        endpoint = %info.endpoint,
                        p2p_addrs = ?info.p2p_addrs,
                        "provider metadata"
                    );
                    providers.push(info);
                }
                Err(e) => {
                    tracing::warn!(address = %addr, error = %e, "failed to get provider metadata");
                }
            }
        }

        Ok(providers)
    }

    /// Update provider metadata (endpoint + P2P addresses) in the smart contract.
    /// Requires gRPC client with private key (use `with_grpc` constructor).
    pub async fn update_provider_metadata(
        &self,
        endpoint: &str,
        p2p_addrs: &[String],
    ) -> Result<String> {
        let grpc = self
            .grpc_client
            .as_ref()
            .ok_or_else(|| anyhow!("gRPC client not configured (missing private key)"))?;

        // Build args: endpoint (string) + p2p_addrs (string array)
        let mut args = Args::new();
        args.add_string(endpoint);
        args.add_string_array(p2p_addrs);

        let mut client = grpc.lock().await;
        let op_id = client
            .call_sc(
                &self.contract_address,
                "updateProviderMetadata",
                args.into_bytes(),
                "0.01",      // fee
                10_000_000,  // max_gas
                Amount::from_raw(0), // coins
            )
            .await
            .map_err(|e| anyhow!("Failed to call updateProviderMetadata: {}", e))?;

        tracing::info!(
            operation_id = %op_id,
            endpoint = %endpoint,
            p2p_addrs_count = p2p_addrs.len(),
            "provider metadata update sent"
        );

        Ok(op_id)
    }

    /// Record a file upload in the storage registry (updates total storage usage per uploader).
    /// Callable only when the server is a storage admin on the contract. Requires gRPC client.
    pub async fn record_file_upload(
        &self,
        uploader_address: &str,
        file_size_bytes: u64,
    ) -> Result<String> {
        let grpc = self
            .grpc_client
            .as_ref()
            .ok_or_else(|| anyhow!("gRPC client not configured (cannot record file upload)"))?;

        if file_size_bytes == 0 {
            return Ok(String::new());
        }

        let mut args = Args::new();
        args.add_string(uploader_address);
        args.add_u64(file_size_bytes);

        let mut client = grpc.lock().await;
        let op_id = client
            .call_sc(
                &self.contract_address,
                "recordFileUpload",
                args.into_bytes(),
                "0.01",
                10_000_000,
                Amount::from_raw(0),
            )
            .await
            .map_err(|e| anyhow!("Failed to call recordFileUpload: {}", e))?;

        tracing::info!(
            operation_id = %op_id,
            uploader = %uploader_address,
            size_bytes = file_size_bytes,
            "file upload recorded on contract"
        );

        Ok(op_id)
    }
}

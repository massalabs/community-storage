//! Massa smart contract interaction via JSON-RPC.
//!
//! Queries the storage registry contract to discover other providers' P2P addresses.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

use crate::args::Args;

/// Provider info from the contract
#[derive(Debug, Clone)]
pub struct ProviderInfo {
    pub address: String,
    pub endpoint: String,
    pub p2p_addrs: Vec<String>,
}

/// Massa JSON-RPC client
pub struct MassaClient {
    http: reqwest::Client,
    rpc_url: String,
    contract_address: String,
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
}

impl MassaClient {
    pub fn new(rpc_url: String, contract_address: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            rpc_url,
            contract_address,
        }
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
}

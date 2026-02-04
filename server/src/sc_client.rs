//! Call storage registry smart contract (getIsAllowedUploader) via Massa JSON-RPC.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Serialize a single string argument for Massa SC (u32 length LE + utf8 bytes).
fn serialize_string_arg(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    let len = bytes.len() as u32;
    let mut out = Vec::with_capacity(4 + bytes.len());
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(bytes);
    out
}

/// Request one read-only call. Field names match Massa node API.
#[derive(Debug, Serialize)]
struct ReadOnlyCallParam {
    max_gas: u64,
    target_address: String,
    target_function: String,
    parameter: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    caller_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    coins: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fee: Option<String>,
}

/// JSON-RPC request body.
#[derive(Debug, Serialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    id: u64,
    method: &'static str,
    params: Vec<Vec<ReadOnlyCallParam>>,
}

/// Per-call result: Ok is return value bytes.
#[derive(Debug, Deserialize)]
struct CallResultInner {
    #[serde(rename = "Ok")]
    ok: Option<Vec<u8>>,
    #[serde(rename = "Error")]
    error: Option<String>,
}

/// execute_read_only_call returns an array of one result per call.
#[derive(Debug, Deserialize)]
struct CallResultItem {
    result: CallResultInner,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    /// RPC result is array of call results.
    result: Option<Vec<CallResultItem>>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    message: String,
}

const MAX_GAS: u64 = 4294167295;

/// Returns true if the address is allowed to upload (storage admin or has booked storage).
pub async fn get_is_allowed_uploader(
    rpc_url: &str,
    contract_address: &str,
    address: &str,
) -> Result<bool, String> {
    let param = ReadOnlyCallParam {
        max_gas: MAX_GAS,
        target_address: contract_address.to_string(),
        target_function: "getIsAllowedUploader".to_string(),
        parameter: serialize_string_arg(address),
        caller_address: None,
        coins: None,
        fee: None,
    };

    let body = JsonRpcRequest {
        jsonrpc: "2.0",
        id: 1,
        method: "execute_read_only_call",
        params: vec![vec![param]],
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("RPC HTTP {}: {}", status, text));
    }

    let rpc: JsonRpcResponse = serde_json::from_str(&text).map_err(|e| format!("RPC parse: {}", e))?;

    if let Some(err) = rpc.error {
        return Err(format!("RPC error: {}", err.message));
    }

    let results = rpc.result.ok_or("RPC: no result")?;
    let first = results.first().ok_or("RPC: empty result array")?;
    let result = &first.result;

    if let Some(ref err) = result.error {
        return Err(format!("SC execution error: {}", err));
    }

    let value = result.ok.as_ref().ok_or("RPC: no return value")?;
    // Contract returns u64 (1 or 0) as 8 bytes little-endian
    if value.len() < 8 {
        return Ok(false);
    }
    let u64_bytes: [u8; 8] = value[..8].try_into().unwrap();
    let n = u64::from_le_bytes(u64_bytes);
    Ok(n == 1)
}

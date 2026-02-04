//! Massa gRPC client for smart contract interactions.
//!
//! Provides:
//! - Smart contract calls (write operations)
//! - Datastore reads
//! - Balance queries
//! - Keypair generation and address utilities

use std::str::FromStr;

use anyhow::{Context, Error, Result};
use massa_models::{
    address::Address,
    amount::Amount,
    operation::{Operation, OperationSerializer, OperationType, SecureShareOperation},
    secure_share::{SecureShareContent, SecureShareSerializer},
};
use massa_proto_rs::massa::api::v1::{
    execution_query_request_item, execution_query_response, execution_query_response_item,
    public_service_client::PublicServiceClient, AddressBalanceCandidate,
    ExecutionQueryRequestItem, GetDatastoreEntriesRequest, GetStatusRequest,
    QueryStateRequest, SendOperationsRequest, get_datastore_entry_filter,
    send_operations_response,
};
use massa_proto_rs::massa::model::v1::AddressKeyEntry;
use massa_serialization::Serializer;
use massa_signature::KeyPair;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::Channel;

/// Chain ID for transaction signing
#[derive(Debug, Clone, Copy)]
pub enum ChainId {
    Mainnet = 0,
    Buildnet = 77658366,
}

impl ChainId {
    pub fn to_u64(self) -> u64 {
        self as u64
    }
}

// ============================================================================
// Keypair and Address Utilities
// ============================================================================

/// Generate a new random keypair
pub fn generate_keypair() -> KeyPair {
    KeyPair::generate(0).expect("Failed to generate keypair")
}

/// Get keypair from private key string (S12...)
pub fn keypair_from_str(private_key: &str) -> Result<KeyPair> {
    KeyPair::from_str(private_key).map_err(|e| Error::msg(format!("Invalid private key: {}", e)))
}

/// Get Massa address from keypair
pub fn address_from_keypair(keypair: &KeyPair) -> String {
    Address::from_public_key(&keypair.get_public_key()).to_string()
}

/// Get Massa address from private key string
pub fn address_from_private_key(private_key: &str) -> Result<String> {
    let keypair = keypair_from_str(private_key)?;
    Ok(address_from_keypair(&keypair))
}

/// Parse an address string and validate it
pub fn parse_address(address: &str) -> Result<Address> {
    Address::from_str(address).context("Invalid Massa address")
}

// ============================================================================
// gRPC Client
// ============================================================================

/// gRPC client for Massa smart contract calls
#[derive(Debug, Clone)]
pub struct GrpcClient {
    client: PublicServiceClient<Channel>,
    keypair: KeyPair,
    chain_id: ChainId,
}

impl GrpcClient {
    /// Create a new gRPC client
    pub async fn new(grpc_url: &str, private_key: &str, chain_id: ChainId) -> Result<Self> {
        let client = PublicServiceClient::connect(grpc_url.to_string())
            .await
            .context("Failed to connect to gRPC")?;

        let keypair =
            KeyPair::from_str(private_key).map_err(|e| Error::msg(format!("Invalid key: {}", e)))?;

        Ok(Self {
            client,
            keypair,
            chain_id,
        })
    }

    /// Get current period + buffer for transaction expiry
    pub async fn get_expire_period(&mut self) -> Result<u64> {
        let response = self
            .client
            .get_status(GetStatusRequest {})
            .await
            .context("Failed to get status")?
            .into_inner();

        let status = response.status.context("No status in response")?;
        let last_slot = status
            .last_executed_speculative_slot
            .context("No last slot")?;

        // Add 10 periods buffer
        Ok(last_slot.period + 10)
    }

    /// Call a smart contract function
    pub async fn call_sc(
        &mut self,
        contract_address: &str,
        function_name: &str,
        args: Vec<u8>,
        fee: &str,
        max_gas: u64,
        coins: Amount,
    ) -> Result<String> {
        let expire_period = self.get_expire_period().await?;

        let operation = Operation {
            fee: Amount::from_str(fee).context("Invalid fee")?,
            expire_period,
            op: OperationType::CallSC {
                target_addr: Address::from_str(contract_address).context("Invalid address")?,
                target_func: function_name.to_string(),
                param: args,
                max_gas,
                coins,
            },
        };

        // Sign the operation
        let secured: SecureShareOperation = Operation::new_verifiable(
            operation,
            OperationSerializer::new(),
            &self.keypair,
            self.chain_id.to_u64(),
        )
        .context("Failed to sign operation")?;

        // Serialize
        let mut serialized = Vec::new();
        SecureShareSerializer::new()
            .serialize(&secured, &mut serialized)
            .context("Failed to serialize")?;

        // Send via streaming RPC
        let (tx, rx) = mpsc::channel(1);
        let request = tonic::Request::new(ReceiverStream::new(rx));

        let response = self
            .client
            .send_operations(request)
            .await
            .context("Failed to send operation")?;

        tx.send(SendOperationsRequest {
            operations: vec![serialized],
        })
        .await
        .context("Failed to send to channel")?;

        // Get operation ID from response
        let mut stream = response.into_inner();
        use tokio_stream::StreamExt;

        while let Some(res) = stream.next().await {
            let result = res
                .context("Stream error")?
                .result
                .context("No result")?;

            match result {
                send_operations_response::Result::OperationIds(ops) => {
                    return ops
                        .operation_ids
                        .first()
                        .cloned()
                        .context("No operation ID");
                }
                send_operations_response::Result::Error(e) => {
                    return Err(Error::msg(format!("Operation error: {:?}", e)));
                }
            }
        }

        Err(Error::msg("No response from stream"))
    }

    /// Get the address associated with this client's keypair
    pub fn get_address(&self) -> String {
        address_from_keypair(&self.keypair)
    }

    /// Get MAS balance for an address
    pub async fn get_balance(&mut self, address: &str) -> Result<f64> {
        let request = tonic::Request::new(QueryStateRequest {
            queries: vec![ExecutionQueryRequestItem {
                request_item: Some(
                    execution_query_request_item::RequestItem::AddressBalanceCandidate(
                        AddressBalanceCandidate {
                            address: address.to_string(),
                        },
                    ),
                ),
            }],
        });

        let response = self
            .client
            .query_state(request)
            .await
            .context("Failed to query state")?
            .into_inner();

        let query_response = response
            .responses
            .first()
            .context("No response")?
            .response
            .as_ref()
            .context("No response data")?;

        if let execution_query_response::Response::Result(item) = query_response {
            if let Some(execution_query_response_item::ResponseItem::Amount(amount)) =
                &item.response_item
            {
                // Convert from nanoMAS to MAS
                let nanos = amount.mantissa as f64 * 10f64.powi(-(amount.scale as i32));
                return Ok(nanos);
            }
        }

        Err(Error::msg("Failed to parse balance"))
    }

    /// Read a value from contract datastore
    pub async fn read_datastore(&mut self, address: &str, key: &[u8]) -> Result<Option<Vec<u8>>> {
        let request = GetDatastoreEntriesRequest {
            filters: vec![massa_proto_rs::massa::api::v1::GetDatastoreEntryFilter {
                filter: Some(get_datastore_entry_filter::Filter::AddressKey(
                    AddressKeyEntry {
                        address: address.to_string(),
                        key: key.to_vec(),
                    },
                )),
            }],
        };

        let response = self
            .client
            .get_datastore_entries(request)
            .await
            .context("Failed to read datastore")?
            .into_inner();

        if let Some(entry) = response.datastore_entries.first() {
            if !entry.candidate_value.is_empty() {
                return Ok(Some(entry.candidate_value.clone()));
            }
            if !entry.final_value.is_empty() {
                return Ok(Some(entry.final_value.clone()));
            }
        }

        Ok(None)
    }

    /// Get network status (version, current period, etc.)
    pub async fn get_status(&mut self) -> Result<NetworkStatus> {
        let response = self
            .client
            .get_status(GetStatusRequest {})
            .await
            .context("Failed to get status")?
            .into_inner();

        let status = response.status.context("No status")?;

        Ok(NetworkStatus {
            version: status.version,
            current_period: status
                .last_executed_speculative_slot
                .map(|s| s.period)
                .unwrap_or(0),
            current_thread: status
                .last_executed_speculative_slot
                .map(|s| s.thread)
                .unwrap_or(0),
        })
    }
}

/// Network status information
#[derive(Debug, Clone)]
pub struct NetworkStatus {
    pub version: String,
    pub current_period: u64,
    pub current_thread: u32,
}

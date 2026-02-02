# Distributed Storage Layer Implementation Plan

## Overview

Add a distributed storage layer to Massa chain nodes to permanently store blockchain history with:
- **Configurable retention**: Node operators choose how many final periods to store
- **IPFS-like replication**: Fixed replication factor (3-5 replicas per chunk)
- **Challenge-response proofs**: Periodic challenges to verify storage claims
- **Smart contract incentives**: Fixed MAS reward per GB per period

This replaces the costly centralized AWS database with decentralized node-provided storage.

---

## Architecture Summary

### Current State
- **In-memory storage** (`massa-storage`): Reference-counted, auto-pruned after few minutes
- **RocksDB persistence**: Only stores ledger/execution state, not full block history
- **Pruning policy**: Blocks kept for 5 periods with operations, 32 periods headers-only
- **Lost history**: Old blocks/operations discarded, stored externally in AWS

### Target State
- **Local archival storage**: RocksDB-backed storage for configurable historical periods
- **P2P replication**: Data chunks distributed across storage-providing nodes
- **Proof verification**: Challenge-response system ensures honest storage
- **Token incentives**: MAS rewards for verified storage provision

---

## Implementation Phases

### Phase 1: Core Storage Infrastructure (Foundation)

#### 1.1 Create `massa-distributed-storage-exports` crate

**Files to create:**
- `massa-distributed-storage-exports/src/lib.rs`
- `massa-distributed-storage-exports/src/config.rs`
- `massa-distributed-storage-exports/src/types.rs`
- `massa-distributed-storage-exports/src/archiver.rs`

**Key components:**

```rust
// Core data structures
pub struct DataChunk {
    pub chunk_id: ChunkId,
    pub period: u64,
    pub data: Vec<u8>,
    pub merkle_proof: MerkleProof,
}

// Configuration
pub struct DistributedStorageConfig {
    pub retention_periods: u64,           // How many periods to store
    pub allocated_storage_gb: u64,        // Storage allocation
    pub replication_factor: u8,           // Number of replicas (3-5)
    pub chunk_size: usize,                // Chunk size (1MB default)
    pub challenge_frequency_periods: u64, // How often to challenge
    pub reward_per_gb_per_period: Amount, // Fixed reward rate
    // ... other config fields
}

// Archiver trait for consensus integration
pub trait StorageArchiver: Send + Sync {
    fn archive_finalized_block(&self, period: u64, block_id: &BlockId, block: &ActiveBlock);
    fn archive_finalized_operations(&self, period: u64, operations: Vec<SecureShareOperation>);
}
```

#### 1.2 Create `massa-distributed-storage-worker` crate

**Files to create:**
- `massa-distributed-storage-worker/src/lib.rs`
- `massa-distributed-storage-worker/src/worker.rs`
- `massa-distributed-storage-worker/src/commands.rs`
- `massa-distributed-storage-worker/src/chunking.rs`
- `massa-distributed-storage-worker/src/replication.rs`
- `massa-distributed-storage-worker/src/challenge.rs`
- `massa-distributed-storage-worker/src/storage_backend.rs`
- `massa-distributed-storage-worker/src/rewards.rs`

**Key modules:**

**Chunking Engine** (`chunking.rs`):
- Serialize finalized blocks + operations for a period
- Split data into fixed-size chunks (1MB default)
- Build Merkle tree over chunks for verification
- Generate Merkle proofs for each chunk

**Replication Manager** (`replication.rs`):
- Deterministic chunk assignment algorithm (chunk_hash mod node_count)
- Respect storage capacity constraints
- Handle node join/leave rebalancing
- Track which nodes store which chunks

**Challenge Manager** (`challenge.rs`):
- Periodic random challenge generation (every N periods)
- Challenge creation: random node + chunk + nonce
- Proof verification: Merkle proof + signature validation
- Track challenge history and success rates

**Local Storage Backend** (`storage_backend.rs`):
- RocksDB-backed chunk storage with new column family
- Chunk retrieval for proof generation
- Pruning based on retention policy
- Metadata tracking (stored chunks, periods)

**Reward Distributor** (`rewards.rs`):
- Calculate rewards: `storage_gb × periods × reward_per_gb_per_period × success_rate`
- Call smart contract for distribution
- Track node performance metrics

---

### Phase 2: Protocol Integration (P2P Layer)

#### 2.1 Add Storage Handler

**Files to create/modify:**
- Create: `massa-protocol-worker/src/handlers/storage_handler/mod.rs`
- Create: `massa-protocol-worker/src/handlers/storage_handler/messages.rs`
- Create: `massa-protocol-worker/src/handlers/storage_handler/propagation.rs`
- Create: `massa-protocol-worker/src/handlers/storage_handler/retrieval.rs`
- Create: `massa-protocol-worker/src/handlers/storage_handler/commands_propagation.rs`
- Create: `massa-protocol-worker/src/handlers/storage_handler/commands_retrieval.rs`
- Create: `massa-protocol-worker/src/handlers/storage_handler/cache.rs`

**Pattern**: Follow existing `BlockHandler` architecture (see `massa-protocol-worker/src/handlers/block_handler/mod.rs`)
- Two threads: retrieval (handle requests) + propagation (announce chunks)
- Channel-based communication with MassaSender/MassaReceiver
- Shared cache for recent chunks

**Storage Messages** (`messages.rs`):
```rust
pub enum StorageMessage {
    ChunkAnnouncement { chunk_ids: Vec<ChunkId>, period: u64 },
    ChunkRequest { chunk_id: ChunkId },
    ChunkResponse { chunk_id: ChunkId, data: Option<Vec<u8>>, merkle_proof: MerkleProof },
    Challenge { challenge_id: Hash, chunk_id: ChunkId, nonce: u64 },
    ChallengeProof { proof: StorageProof },
    StorageCapabilities { allocated_storage_gb: u64, stored_chunks: Vec<ChunkId> },
}
```

#### 2.2 Update Protocol Messages

**File to modify:** `massa-protocol-worker/src/messages.rs`

Add storage to main message enum:
```rust
pub enum Message {
    Block(Box<BlockMessage>),
    Endorsement(EndorsementMessage),
    Operation(OperationMessage),
    PeerManagement(Box<PeerManagementMessage>),
    Storage(Box<StorageMessage>),  // NEW
}

pub enum MessageTypeId {
    Block = 0,
    Endorsement = 1,
    Operation = 2,
    PeerManagement = 3,
    Storage = 4,  // NEW
}
```

#### 2.3 Update Protocol Config

**File to modify:** `massa-protocol-exports/src/settings.rs`

Add storage configuration fields:
```rust
pub struct ProtocolConfig {
    // ... existing fields ...
    pub max_storage_messages_per_second: usize,
    pub max_chunk_size: usize,
    pub max_stored_chunks_per_node: usize,
    pub max_size_channel_commands_retrieval_storage: usize,
    pub max_size_channel_commands_propagation_storage: usize,
    pub max_size_channel_network_to_storage_handler: usize,
}
```

---

### Phase 3: Consensus Integration (Hook Finalization)

**File to modify:** `massa-consensus-worker/src/state/prune.rs`

**Location**: In `prune_active()` method, around line 56-88 where `discarded_finals` map is built

**Implementation**:
```rust
impl ConsensusState {
    fn prune_active(&mut self) -> Result<PreHashMap<BlockId, ActiveBlock>, ConsensusError> {
        // ... existing code to build discarded_finals ...

        // NEW: Archive finalized blocks before discarding
        for (block_id, active_block) in &discarded_finals {
            if let Some(storage_archiver) = &self.storage_archiver {
                storage_archiver.archive_finalized_block(
                    active_block.slot.period,
                    block_id,
                    active_block,
                );
            }
        }

        // ... rest of existing logic ...
    }
}
```

**File to modify:** `massa-consensus-exports/src/settings.rs`

Add optional archiver:
```rust
pub struct ConsensusConfig {
    // ... existing fields ...
    pub storage_archiver: Option<Arc<dyn StorageArchiver>>,
}
```

---

### Phase 4: Smart Contract System (Incentives)

The smart contract is written in **AssemblyScript** and lives in a **separate repository** for independent versioning and deployment.

#### 4.1 Project Structure

**Repository:** `massa-storage-sc` (separate GitHub repo)

**Initialize with:**
```bash
npx @massalabs/sc-project-initializer init massa-storage-sc
```

**Project structure:**
```
massa-storage-sc/
├── assembly/
│   ├── contracts/
│   │   └── storage-registry.ts      # Main contract
│   ├── interfaces/
│   │   └── IStorageRegistry.ts      # Contract interface
│   ├── structs/
│   │   ├── StorageNode.ts           # Node data structure
│   │   ├── Challenge.ts             # Challenge data structure
│   │   └── PeriodStats.ts           # Period statistics
│   └── index.ts                     # Exports
├── src/
│   └── deploy.ts                    # Deployment script
├── package.json
├── asconfig.json
└── README.md
```

#### 4.2 Storage Registry Smart Contract Specification

**File:** `assembly/contracts/storage-registry.ts`

**Dependencies:**
```typescript
import {
  Storage, Context, generateEvent, Address,
  transferCoins, balance, caller, callee,
  currentPeriod, timestamp
} from '@massalabs/massa-as-sdk';
import { Args, Result } from '@massalabs/as-types';
```

**Storage Keys (prefixes):**
```typescript
const NODE_PREFIX = "node_";           // node_{address} → StorageNode
const CHALLENGE_PREFIX = "chal_";      // chal_{id} → Challenge
const PERIOD_PREFIX = "period_";       // period_{num} → PeriodStats
const ADMIN_KEY = "admin";             // Contract admin address
const CONFIG_KEY = "config";           // Contract configuration
const TOTAL_NODES_KEY = "total_nodes"; // Total registered nodes count
```

**Data Structures:**

```typescript
// assembly/structs/StorageNode.ts
@serializable
export class StorageNode {
  address: string;              // Node's address
  allocatedGb: u64;             // Allocated storage in GB
  registeredPeriod: u64;        // Period when registered
  totalChallenges: u64;         // Total challenges received
  passedChallenges: u64;        // Challenges passed
  pendingRewards: u64;          // Unclaimed rewards (nanoMAS)
  lastChallengedPeriod: u64;    // Last challenge period
  active: bool;                 // Is node currently active
}

// assembly/structs/Challenge.ts
@serializable
export class Challenge {
  id: string;                   // Challenge unique ID (hash)
  nodeAddress: string;          // Challenged node
  chunkId: string;              // Chunk to prove
  nonce: u64;                   // Random nonce
  issuedPeriod: u64;            // Period when issued
  deadline: u64;                // Timestamp deadline
  resolved: bool;               // Has been resolved
  passed: bool;                 // Did node pass
}

// assembly/structs/PeriodStats.ts
@serializable
export class PeriodStats {
  period: u64;
  totalGbStored: u64;           // Total GB across all nodes
  totalRewardsDistributed: u64; // Total MAS distributed
  activeNodes: u64;             // Number of active nodes
  challengesIssued: u64;        // Challenges this period
  challengesPassed: u64;        // Passed challenges
}
```

**Contract Configuration:**
```typescript
@serializable
export class StorageConfig {
  rewardPerGbPerPeriod: u64;    // nanoMAS reward rate
  minAllocatedGb: u64;          // Minimum storage to register
  maxAllocatedGb: u64;          // Maximum storage per node
  challengeResponseTimeout: u64; // Timeout in milliseconds
  slashPercentage: u64;         // % penalty for failed challenge (0-100)
  minStake: u64;                // Required stake to register (nanoMAS)
}
```

**Exported Functions:**

```typescript
// ═══════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize the contract with admin and configuration
 * Called once at deployment via constructor
 * @param binaryArgs - Serialized Args containing:
 *   - admin: string (admin address)
 *   - config: StorageConfig
 */
export function constructor(binaryArgs: StaticArray<u8>): void;

// ═══════════════════════════════════════════════════════════════════
// NODE REGISTRATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Register as a storage provider
 * Requires transferring minStake MAS with the call
 * @param binaryArgs - Serialized Args containing:
 *   - allocatedGb: u64 (storage allocation in GB)
 * @emits STORAGE_NODE_REGISTERED(address, allocatedGb)
 */
export function registerStorageNode(binaryArgs: StaticArray<u8>): void;

/**
 * Update storage allocation (increase or decrease)
 * @param binaryArgs - Serialized Args containing:
 *   - newAllocatedGb: u64
 * @emits STORAGE_NODE_UPDATED(address, oldGb, newGb)
 */
export function updateStorageAllocation(binaryArgs: StaticArray<u8>): void;

/**
 * Unregister from storage provision
 * Returns stake minus any pending slashes
 * @emits STORAGE_NODE_UNREGISTERED(address, stakeReturned)
 */
export function unregisterStorageNode(_: StaticArray<u8>): void;

// ═══════════════════════════════════════════════════════════════════
// CHALLENGE SYSTEM
// ═══════════════════════════════════════════════════════════════════

/**
 * Issue a challenge to a storage node (called by consensus/protocol)
 * Only callable by authorized challenger addresses
 * @param binaryArgs - Serialized Args containing:
 *   - challengeId: string (unique hash)
 *   - nodeAddress: string
 *   - chunkId: string
 *   - nonce: u64
 * @emits CHALLENGE_ISSUED(challengeId, nodeAddress, chunkId)
 */
export function issueChallenge(binaryArgs: StaticArray<u8>): void;

/**
 * Submit proof for a challenge
 * @param binaryArgs - Serialized Args containing:
 *   - challengeId: string
 *   - merkleProof: StaticArray<u8> (serialized Merkle proof)
 *   - signature: StaticArray<u8>
 * @emits CHALLENGE_PASSED(challengeId, nodeAddress)
 * @emits CHALLENGE_FAILED(challengeId, nodeAddress, reason)
 */
export function submitProof(binaryArgs: StaticArray<u8>): void;

/**
 * Mark expired challenges as failed (can be called by anyone)
 * @param binaryArgs - Serialized Args containing:
 *   - challengeIds: Array<string>
 * @emits CHALLENGE_EXPIRED(challengeId, nodeAddress)
 */
export function resolveExpiredChallenges(binaryArgs: StaticArray<u8>): void;

// ═══════════════════════════════════════════════════════════════════
// REWARD DISTRIBUTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Distribute rewards for a completed period
 * Calculates: reward = allocatedGb × rewardPerGbPerPeriod × successRate
 * @param binaryArgs - Serialized Args containing:
 *   - period: u64
 * @emits REWARDS_DISTRIBUTED(period, totalAmount, nodeCount)
 */
export function distributeRewards(binaryArgs: StaticArray<u8>): void;

/**
 * Claim accumulated rewards
 * Transfers pendingRewards to caller
 * @emits REWARDS_CLAIMED(address, amount)
 */
export function claimRewards(_: StaticArray<u8>): void;

// ═══════════════════════════════════════════════════════════════════
// VIEW FUNCTIONS (Read-only)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get storage node information
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 * @returns Serialized StorageNode
 */
export function getNodeInfo(binaryArgs: StaticArray<u8>): StaticArray<u8>;

/**
 * Get challenge information
 * @param binaryArgs - Serialized Args containing:
 *   - challengeId: string
 * @returns Serialized Challenge
 */
export function getChallenge(binaryArgs: StaticArray<u8>): StaticArray<u8>;

/**
 * Get period statistics
 * @param binaryArgs - Serialized Args containing:
 *   - period: u64
 * @returns Serialized PeriodStats
 */
export function getPeriodStats(binaryArgs: StaticArray<u8>): StaticArray<u8>;

/**
 * Get contract configuration
 * @returns Serialized StorageConfig
 */
export function getConfig(_: StaticArray<u8>): StaticArray<u8>;

/**
 * Get total registered nodes count
 * @returns u64 as bytes
 */
export function getTotalNodes(_: StaticArray<u8>): StaticArray<u8>;

/**
 * Calculate pending rewards for a node
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 * @returns u64 pending rewards in nanoMAS
 */
export function calculatePendingRewards(binaryArgs: StaticArray<u8>): StaticArray<u8>;

// ═══════════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Update contract configuration (admin only)
 * @param binaryArgs - Serialized StorageConfig
 * @emits CONFIG_UPDATED(oldConfig, newConfig)
 */
export function updateConfig(binaryArgs: StaticArray<u8>): void;

/**
 * Add authorized challenger address (admin only)
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 */
export function addChallenger(binaryArgs: StaticArray<u8>): void;

/**
 * Remove authorized challenger address (admin only)
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 */
export function removeChallenger(binaryArgs: StaticArray<u8>): void;

/**
 * Emergency pause/unpause contract (admin only)
 * @param binaryArgs - Serialized Args containing:
 *   - paused: bool
 */
export function setPaused(binaryArgs: StaticArray<u8>): void;
```

**Events:**
```typescript
// Node events
STORAGE_NODE_REGISTERED(address: string, allocatedGb: u64)
STORAGE_NODE_UPDATED(address: string, oldGb: u64, newGb: u64)
STORAGE_NODE_UNREGISTERED(address: string, stakeReturned: u64)

// Challenge events
CHALLENGE_ISSUED(challengeId: string, nodeAddress: string, chunkId: string)
CHALLENGE_PASSED(challengeId: string, nodeAddress: string)
CHALLENGE_FAILED(challengeId: string, nodeAddress: string, reason: string)
CHALLENGE_EXPIRED(challengeId: string, nodeAddress: string)

// Reward events
REWARDS_DISTRIBUTED(period: u64, totalAmount: u64, nodeCount: u64)
REWARDS_CLAIMED(address: string, amount: u64)

// Admin events
CONFIG_UPDATED(field: string, oldValue: string, newValue: string)
```

**Reward Calculation Logic:**
```typescript
function calculateReward(node: StorageNode, config: StorageConfig): u64 {
  if (node.totalChallenges == 0) {
    return 0;
  }

  // Success rate as percentage (0-100)
  const successRate = (node.passedChallenges * 100) / node.totalChallenges;

  // Periods since registration
  const periodsActive = currentPeriod() - node.registeredPeriod;

  // reward = allocatedGb × periodsActive × rewardPerGbPerPeriod × (successRate / 100)
  const baseReward = node.allocatedGb * periodsActive * config.rewardPerGbPerPeriod;
  const adjustedReward = (baseReward * successRate) / 100;

  return adjustedReward;
}
```

#### 4.3 Integration with Node

**Pattern**: Follow existing reward distribution in `massa-execution-worker/src/execution.rs:1652`

**File to create:** `massa-distributed-storage-worker/src/smart_contract/client.rs`

Rust client to interact with the deployed AS smart contract:
- Call `issueChallenge()` when challenge manager selects a node
- Call `distributeRewards()` at end of reward period
- Read `getNodeInfo()` to get node success rates

**Contract Address Configuration:**
```toml
# massa-node/base_config/config.toml
[distributed_storage]
    storage_registry_address = "AS1..."  # Deployed SC address
```

---

### Phase 5: Worker Orchestration

**File to create:** `massa-distributed-storage-worker/src/worker.rs`

**Main event loop:**
1. Listen for finalized periods from consensus (via archiver hook)
2. Chunk period data and calculate Merkle tree
3. Determine chunk assignments (replication manager)
4. Store local chunks + announce to network
5. Handle chunk requests from peers
6. Periodically issue challenges
7. Verify received proofs
8. Trigger reward distribution every N periods

**Commands:**
```rust
pub enum DistributedStorageCommand {
    ArchivePeriod { period: u64, blocks: Vec<SecureShareBlock>, operations: Vec<SecureShareOperation> },
    HandleChunkRequest { peer_id: PeerId, chunk_id: ChunkId },
    HandleChallenge { challenge: Challenge },
    DistributeRewards { period: u64 },
    Stop,
}
```

---

### Phase 6: Configuration Integration

#### 6.1 Add to Node Config

**File to modify:** `massa-node/base_config/config.toml`

Add new section:
```toml
[distributed_storage]
    enabled = false
    allocated_storage_gb = 10
    retention_periods = 100
    replication_factor = 3
    chunk_size = 1048576  # 1MB
    challenge_frequency_periods = 100
    reward_per_gb_per_period = 1000000  # nanoMAS
    min_challenge_interval = 3600000  # 1 hour in ms
    challenge_response_timeout = 60000  # 1 minute in ms
    storage_registry_address = ""  # Auto-deployed if empty
```

**File to modify:** `massa-node/src/settings.rs`

Add parsing for `DistributedStorageConfig`.

#### 6.2 Database Schema

**File to modify:** `massa-db-exports/src/lib.rs`

Add column family prefixes:
```rust
pub const STORAGE_CHUNKS_PREFIX: &str = "storage_chunks";
pub const STORAGE_NODE_REGISTRY_PREFIX: &str = "storage_nodes";
pub const STORAGE_CHALLENGE_HISTORY_PREFIX: &str = "challenge_history";
pub const STORAGE_MERKLE_ROOTS_PREFIX: &str = "merkle_roots";
```

---

## Data Flows

### 1. Archival Flow
```
Consensus finalizes blocks/ops
  ↓
prune_active() hook calls storage_archiver.archive_finalized_block()
  ↓
DistributedStorageWorker receives ArchivePeriod command
  ↓
ChunkingEngine: serialize → chunk → build Merkle tree
  ↓
ReplicationManager: assign chunks to nodes deterministically
  ↓
LocalStorageBackend: store assigned chunks in RocksDB
  ↓
StorageHandler: announce chunks to network via ChunkAnnouncement
```

### 2. Replication Flow
```
Node receives ChunkAnnouncement from peer
  ↓
Check if we're assigned to store this chunk (deterministic algorithm)
  ↓
If yes: send ChunkRequest
  ↓
Peer responds with ChunkResponse (data + Merkle proof)
  ↓
Verify Merkle proof
  ↓
LocalStorageBackend: store chunk
```

### 3. Challenge-Response Flow
```
ChallengeManager: periodic timer triggers (every N periods)
  ↓
Select random nodes + chunks for challenge
  ↓
Send Challenge message via network (challenge_id, chunk_id, nonce)
  ↓
Storage node receives challenge
  ↓
LocalStorageBackend: retrieve chunk
  ↓
Generate proof: Merkle proof + signature
  ↓
Send ChallengeProof message
  ↓
ChallengeManager: verify proof
  ↓
Update success rate for node
  ↓
Submit proof to smart contract for reward eligibility
```

### 4. Reward Distribution Flow
```
Periodic trigger (every N periods)
  ↓
RewardDistributor calls storage_registry.distribute_rewards(period)
  ↓
Smart contract calculates rewards for each node:
  reward = allocated_gb × periods × rate × success_rate
  ↓
Smart contract calls transfer_coins() for each node
  ↓
Emit events for tracking
```

---

## Critical Files Reference

### Files to Create (New Modules)
1. `massa-distributed-storage-exports/src/lib.rs` - Core types and traits
2. `massa-distributed-storage-exports/src/config.rs` - Configuration
3. `massa-distributed-storage-worker/src/worker.rs` - Main worker logic
4. `massa-distributed-storage-worker/src/chunking.rs` - Data chunking + Merkle trees
5. `massa-distributed-storage-worker/src/replication.rs` - Chunk assignment
6. `massa-distributed-storage-worker/src/challenge.rs` - Proof-of-storage
7. `massa-distributed-storage-worker/src/storage_backend.rs` - RocksDB integration
8. `massa-distributed-storage-worker/src/rewards.rs` - Reward calculation
9. `massa-distributed-storage-worker/src/smart_contract/storage_registry.rs` - SC implementation
10. `massa-protocol-worker/src/handlers/storage_handler/mod.rs` - P2P handler
11. `massa-protocol-worker/src/handlers/storage_handler/messages.rs` - Message definitions

### Files to Modify (Integration Points)
1. `massa-consensus-worker/src/state/prune.rs` - Hook archival (line ~56-88)
2. `massa-protocol-worker/src/messages.rs` - Add Storage message type
3. `massa-protocol-exports/src/settings.rs` - Add storage config
4. `massa-consensus-exports/src/settings.rs` - Add storage_archiver field
5. `massa-node/base_config/config.toml` - Add [distributed_storage] section
6. `massa-node/src/settings.rs` - Parse storage config
7. `massa-db-exports/src/lib.rs` - Add storage column families

---

## Phased Implementation Timeline

### Phase 1: Local Storage (Weeks 1-2)
- Create exports and worker crates
- Implement chunking engine
- Implement local storage backend
- Unit tests for chunking and Merkle trees

### Phase 2: Replication (Weeks 3-4)
- Implement replication manager
- Deterministic chunk assignment algorithm
- Hook into consensus finalization
- Integration tests for archival

### Phase 3: P2P Protocol (Weeks 5-6)
- Create storage handler (following BlockHandler pattern)
- Define and implement storage messages
- Integrate with protocol worker
- Network tests for chunk propagation

### Phase 4: Challenge System (Weeks 7-8)
- Implement challenge manager
- Proof generation and verification
- Merkle proof validation
- Security tests for proof system

### Phase 5: Smart Contract (Weeks 9-10)
- Develop storage registry SC
- Deployment automation
- Reward calculation logic
- Contract unit tests

### Phase 6: Incentives (Weeks 11-12)
- Reward distributor implementation
- Integration with execution worker
- Success rate tracking
- End-to-end tests for reward flow

### Phase 7: Polish (Weeks 13-14)
- Configuration integration
- Documentation
- Performance optimization
- Bug fixes and edge cases

---

## Testing Strategy

### Unit Tests
- **Chunking**: Verify serialization, chunking, Merkle tree generation
- **Replication**: Test chunk assignment algorithm, rebalancing
- **Challenges**: Test proof generation, verification, timing
- **Rewards**: Test calculation formulas, edge cases

### Integration Tests
- **Archival flow**: Consensus → worker → storage
- **Replication flow**: Chunk announcement → request → storage
- **Challenge flow**: Challenge → proof → verification
- **Reward flow**: Distribution trigger → SC call → transfers

### Network Tests
- Multi-node setup with storage enabled
- Test chunk propagation between nodes
- Test challenge-response with network delays
- Test node join/leave rebalancing

### Security Tests
- Invalid Merkle proof rejection
- Signature verification
- Challenge replay prevention
- Sybil resistance (require staking)

---

## Security Considerations

1. **Sybil Resistance**: Require nodes to stake MAS to participate (implement in SC)
2. **Challenge Randomness**: Use VRF or on-chain randomness to prevent gaming
3. **Proof Integrity**: Merkle proofs + signatures prevent fake storage claims
4. **Rate Limiting**: Prevent DoS via excessive storage requests
5. **Economic Incentives**: Ensure rewards > storage costs to maintain participation
6. **Slashing**: Penalize nodes that fail challenges (reduce rewards or temporary ban)

---

## Performance Considerations

1. **Chunk Size**: 1MB balances granularity (small = more overhead) vs efficiency
2. **Replication Factor**: 3-5 replicas balances availability vs storage cost
3. **Challenge Frequency**: Every 100 periods balances verification vs overhead
4. **Message Priority**: Storage messages low-priority (like operations) to not block consensus
5. **Database Compaction**: Regular pruning of old challenges and expired chunks
6. **Bandwidth**: Announce hashes, pull full data only on-demand (like blocks)

---

## Verification Plan

### How to Test End-to-End

1. **Enable storage on 3+ nodes** in testnet config
   ```toml
   [distributed_storage]
   enabled = true
   allocated_storage_gb = 1
   retention_periods = 10
   replication_factor = 3
   ```

2. **Let chain finalize blocks** - watch logs for archival messages
   ```
   [INFO] Archived period 100: 5 blocks, 123 operations, 15 chunks
   [INFO] Chunks assigned to nodes: node_A[5], node_B[5], node_C[5]
   ```

3. **Verify chunk propagation** - check RocksDB for stored chunks
   ```bash
   massa-cli storage list-chunks
   # Should show ~5 chunks per node (15 total / 3 nodes)
   ```

4. **Trigger challenge manually** (via API or wait for periodic trigger)
   ```bash
   massa-cli storage issue-challenge --node <node_id> --chunk <chunk_id>
   ```

5. **Verify proof submission** - check logs for verification
   ```
   [INFO] Challenge issued to node_A for chunk abc123
   [INFO] Proof received from node_A - VALID
   [INFO] Success rate updated: node_A = 100%
   ```

6. **Check reward distribution** - query SC state after reward period
   ```bash
   massa-cli sc call storage_registry get_node_info <node_id>
   # Should show: allocated_gb=1, success_rate=1.0, pending_rewards=X
   ```

7. **Verify balance increase** - after distribution, check node wallet
   ```bash
   massa-cli wallet balance
   # Should increase by reward_per_gb_per_period × gb × periods
   ```

---

## Success Metrics

- ✅ Nodes successfully archive finalized blocks to local storage
- ✅ Chunks replicated to N nodes (configurable replication factor)
- ✅ Challenges issued and proofs verified correctly
- ✅ Rewards distributed proportional to storage provided
- ✅ Historical data retrievable from distributed storage (vs AWS)
- ✅ Storage cost < AWS cost (decentralized efficiency)
- ✅ Node operators incentivized to allocate storage

---

## Open Questions / Future Enhancements

1. **Data retrieval API**: How should users/apps query historical data from storage layer?
2. **Geographic diversity**: Track node locations for better replication distribution?
3. **Erasure coding**: More storage-efficient than full replication (future optimization)
4. **Dynamic rewards**: Adjust reward rate based on network storage supply/demand?
5. **Slashing severity**: How much to penalize failed challenges? Temporary ban vs permanent?
6. **Bootstrapping**: How do new nodes quickly sync historical data from storage layer?

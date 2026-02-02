# Distributed Storage Layer Implementation Plan

## Overview

Add a **distributed storage layer** for node runners who opt in: archive finalized blocks to **local storage**, **replicate** data over P2P, prove availability via **challenges**, and earn **smart contract incentives**—**without modifying blockchain consensus**.

- **Opt-in mode**: Node operators enable a config flag; consensus and protocol logic are unchanged. Finalized block data is obtained via **events / subscription / storage-layer callback**, not by changing `massa-consensus-worker`.
- **Local archival**: Finalized blocks (and optionally operations) are written locally with configurable retention; chunked and stored (e.g. RocksDB or filesystem).
- **P2P replication**: Chunks are replicated across storage-providing nodes (fixed replication factor); protocol handler for chunk announce / request / response.
- **Challenge-response**: Periodic challenges verify that nodes actually store the data; proofs verified off-chain; results reported to smart contract for reward eligibility.
- **Smart contract incentives**: Storage registry contract: register nodes, issue challenges, submit proofs, distribute rewards (challenge-before-rewards, no staking, no slashing). Rewards paid only after all active providers have been challenged for the period.
- **Retrieval API**: HTTP/gRPC API to list and download archived blocks by period/slot/block ID from local (and optionally from peers).
- **Blockchain data = special case**: Only **storage admins** (Massalabs) can upload blocks/operations; **anyone can upload** other data. Every node runner can **index** (read) blockchain data via the Read API.

Use cases: decentralized historical storage, block explorers, indexers, and incentivized node-provided archives—all without touching consensus. Every node runner can index chain data; Massalabs keeps chain data canonical.

---

## Architecture Summary

### Current State
- **In-memory storage** (`massa-storage`): Reference-counted, auto-pruned after few minutes
- **RocksDB persistence**: Only stores ledger/execution state, not full block history
- **Pruning policy**: Blocks kept for 5 periods with operations, 32 periods headers-only
- **Lost history**: Old blocks/operations discarded; no first-party way to keep them on the node

### Target State (Storage-Provider Mode)
- **No consensus changes**: Archival is a **subscriber** to finalized-block data (events/streams or read-only APIs from storage); **no modifications to `massa-consensus-worker`**.
- **Storage client**: The storage layer runs as a **separate, data-agnostic** binary (`massa-storage-client`): **blockchain data (blocks/operations) is a special case** — only **storage admins** (Massalabs) can upload it; **anyone can upload** other data. Exposes signed **upload API** (namespace-based: blockchain = admin check; other = open), **read API** (every node runner can index chain data), and **challenge handling**. Shipped with the node by default. See [Storage Client as Separate Binary](#storage-client-as-separate-binary-path-to-yield-storage-platform).
- **Local archival + chunking**: Finalized data is serialized, chunked (e.g. 1MB), Merkle tree built; stored locally with retention.
- **P2P replication**: Chunk announcements and request/response over existing protocol (new storage message type); deterministic chunk assignment; nodes store their assigned chunks.
- **Challenge-response**: Off-chain challenge issuance and proof verification; results recorded in smart contract for reward eligibility.
- **Smart contract incentives**: Storage registry contract handles registration, challenges, proofs, and reward distribution (fixed MAS per GB per period; challenge-before-rewards).
- **Retrieval API**: List periods / get block by ID or period/slot; serve from local store (and optionally from peers).

---

## Implementation Phases

### Phase 1: Local Archival Module (No Consensus Changes)

#### 1.1 Exports and configuration

**Files to create (or add to existing crates):**
- `massa-archival-exports/src/lib.rs` (or similar)
- `massa-archival-exports/src/config.rs`
- `massa-archival-exports/src/types.rs`

**Configuration:**
```rust
pub struct ArchivalConfig {
    pub enabled: bool,              // Opt-in: only archive when true
    pub retention_periods: u64,      // How many periods to keep
    pub archive_operations: bool,   // Also save operations for each period
    pub storage_path: PathBuf,      // Directory or DB path for archived files
    // P2P replication (when enabled)
    pub replication_factor: u8,     // Replicas per chunk (3–5)
    pub chunk_size: usize,          // Chunk size (e.g. 1MB)
    pub allocated_storage_gb: u64,  // Storage allocation for chunks
    // Challenges and incentives
    pub challenge_frequency_periods: u64,
    pub challenge_response_timeout_ms: u64,
    pub storage_registry_address: Option<Address>,  // Smart contract address
}
```

**Data to archive (per block):** serialized block (e.g. `SecureShareBlock`) and optionally operations; keyed by `(period, slot, block_id)` for retrieval. For P2P/challenges, period data is also chunked and stored (see Phase 1.4).

#### 1.2 Obtaining finalized blocks without modifying consensus

**Goal:** The archival module must receive finalized block data **without changing consensus code**. Options (choose one per implementation):

- **Option A – Event / stream:** If the node already has an internal event bus or channel that emits “block finalized” or “block discarded from active set”, the archival worker **subscribes** to that. No changes in `massa-consensus-worker`; only a new subscriber.
- **Option B – Storage / pool read:** If finalized blocks are still readable from storage or a pool for a short window after finalization, the archival worker can **poll or subscribe** to a read-only API (e.g. from `massa-storage` or a dedicated “finalized block” cache) and copy data before it is pruned. Consensus and pruning logic stay as they are; archival is a passive reader.
- **Option C – Minimal hook in storage layer:** If the only practical place to hook is “when block is about to be pruned” in the **storage** layer (not consensus), add a single optional callback there (e.g. `on_before_prune(block_id, data)`). Consensus remains untouched; only storage notifies one optional listener.

**Deliverable:** A clear contract: “Archival receives finalized block data from [chosen source]” and the corresponding subscription or callback in that layer only.

#### 1.3 Local storage backend

**Files to create:**
- `massa-archival-worker/src/backend.rs` (or `storage_backend.rs`)

**Responsibilities:**
- Write archived blocks (and optionally operations) to local storage:
  - **Option 1:** Filesystem (e.g. one file per block: `{storage_path}/{period}/{slot}_{block_id}.bin`, or a single file per period).
  - **Option 2:** Dedicated RocksDB column family (e.g. in existing node DB or a separate DB) keyed by `(period, slot, block_id)`.
- Enforce **retention**: delete or overwrite data older than `retention_periods`.
- Provide **read** interface: get block by `(period, slot)` or by `block_id`, list periods/slots available (for the API).

#### 1.4 Chunking and chunk storage (for P2P and challenges)

When distributed storage is enabled, the same finalized period data is also:

- **Chunking engine** (`chunking.rs`): Serialize period blocks + operations, split into fixed-size chunks (e.g. 1MB), build Merkle tree over chunks, generate Merkle proof per chunk.
- **Chunk storage backend**: Store chunks and Merkle roots (e.g. RocksDB column family) keyed by `chunk_id`; support retrieval by `chunk_id` for proof generation and P2P serve.
- **Replication manager** (`replication.rs`): Deterministic chunk assignment (chunk_hash mod node_count); track which chunks this node is responsible for; prune chunks beyond retention.

Local block storage (1.3) feeds the retrieval API; chunk storage feeds P2P and challenges. No consensus changes—data source is still the subscription/callback from Phase 1.2.

---

### Phase 2: Archival Worker

**File to create:** `massa-archival-worker/src/worker.rs` (or `massa-distributed-storage-worker`)

**Responsibilities:**
- On startup, if `archival.enabled` is true, subscribe to finalized block source (from Phase 1.2). **No consensus code changes**—only a subscriber.
- On each finalized block (and optionally batch of operations for that period/slot): (1) serialize and store in local block backend (for API); (2) when a period is complete, run chunking engine: serialize period data, split into chunks, build Merkle tree, store chunks in chunk backend; (3) replication manager: determine which chunks this node stores, keep only those; (4) announce assigned chunks to P2P (Phase 3).
- Retention: prune blocks and chunks older than `retention_periods`.

**Commands (internal channel):**
```rust
pub enum ArchivalCommand {
    StoreBlock { period: u64, slot: u64, block_id: BlockId, block: Vec<u8>, operations: Option<Vec<u8>> },
    ArchivePeriod { period: u64, blocks: Vec<u8>, operations: Vec<u8> },  // Triggers chunking + replication
    PruneOlderThan { period: u64 },
    Stop,
}
```

---

### Phase 3: P2P Protocol Integration (Storage Handler)

**No consensus changes.** Add a storage message type and handler in the **protocol** layer so nodes can announce and request chunks.

**Files to create/modify:**
- Create: `massa-protocol-worker/src/handlers/storage_handler/mod.rs`
- Create: `massa-protocol-worker/src/handlers/storage_handler/messages.rs`
- Create: `massa-protocol-worker/src/handlers/storage_handler/propagation.rs`
- Create: `massa-protocol-worker/src/handlers/storage_handler/retrieval.rs`
- Modify: `massa-protocol-worker/src/messages.rs` — add `Storage(Box<StorageMessage>)` to main message enum and `MessageTypeId::Storage`.

**Pattern:** Follow existing `BlockHandler` (two threads: retrieval + propagation; channel-based).

**Storage messages:**
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

**Flow:** Worker (Phase 2) announces chunks via propagation; retrieval thread handles ChunkRequest by reading from chunk backend and sending ChunkResponse. Protocol config: add limits (max_storage_messages_per_second, max_chunk_size, etc.) in `massa-protocol-exports/src/settings.rs`.

---

### Phase 4: Challenge System

**Off-chain challenge issuance and proof verification;** results reported to smart contract for reward eligibility. No consensus changes.

**Files to create:**
- `massa-distributed-storage-worker/src/challenge.rs` — Challenge manager: periodic trigger, select random nodes + chunks, send Challenge via P2P; receive ChallengeProof, verify Merkle proof + signature; call smart contract `issueChallenge` / `submitProof` (or equivalent) to record result.
- Proof generation: when this node receives a Challenge, retrieve chunk from backend, build Merkle proof, sign, send ChallengeProof.

**Flow:** Challenge manager issues challenges every N periods; challenged node responds with proof; verifier checks proof and submits result to storage registry contract. Reward distribution (Phase 5) only after all active providers have been challenged for the period.

---

### Phase 5: Smart Contract System (Incentives)

The storage registry smart contract lives in **this repository** (`smartContract/`) for versioning and deployment. It handles registration, challenges, proofs, and reward distribution—**no consensus logic**, only incentives.

**Repository:** `massa-storage-sc` (this repo)

**Key contract behavior (see `smartContract/assembly/contracts/storage-registry.ts`):**
- **Registration:** Nodes register with `allocatedGb` (no staking). `registerStorageNode`, `updateStorageAllocation`, `unregisterStorageNode`.
- **Challenges:** Authorized challengers call `issueChallenge(challengeId, nodeAddress, chunkId, nonce)`. Nodes submit proofs via `submitProof(challengeId, merkleProof, signature)`. Contract emits CHALLENGE_PASSED / CHALLENGE_FAILED. `resolveExpiredChallenges` for timeouts.
- **Rewards (challenge-before-rewards, no slashing):** `distributeRewards(period, nodeAddresses)` is allowed only after every active provider has been challenged for that period (contract reverts otherwise). Per-node reward: `allocatedGb × rewardPerGbPerPeriod` for nodes that passed all challenges; failed nodes get 0 (no slashing). Providers `claimRewards()` to transfer pending rewards.
- **Config:** `StorageConfig` (rewardPerGbPerPeriod, min/max allocated GB, timeouts, etc.). Admin: `updateConfig`, `addChallenger`, `removeChallenger`, `setPaused`.

**Node integration:** Rust client in `massa-distributed-storage-worker/src/smart_contract/client.rs` (or similar) to call `issueChallenge`, `submitProof`, `distributeRewards`, and read `getNodeInfo` / `getConfig`. Contract address in config: `storage_registry_address`.

---

### Phase 6: Retrieval API

Expose an **API** so clients can list and download archived blocks.

#### 6.1 API shape (recommended)

- **List:** `GET /archived/periods` → list of `period` (and optionally slot ranges) that have archived data.
- **Get by period/slot:** `GET /archived/periods/{period}/slots/{slot}` or `GET /archived/periods/{period}/blocks` → list of blocks for that period (or slot).
- **Get by block ID:** `GET /archived/blocks/{block_id}` → serialized block (and optionally operations) as binary or JSON.

Alternative: **gRPC** with equivalent messages (list periods, get block by id, get block by period/slot).

#### 6.2 Where the API runs

- **Option A:** Same process as the node: add an HTTP/gRPC server in the node that queries the archival backend (only bound when `archival.enabled` is true).
- **Option B:** Separate process: a small “archival API server” that reads from the same storage path or DB as the archival worker (e.g. read-only). Node and API server share config (path/DB).

**Files to create (example for HTTP):**
- `massa-archival-worker/src/api.rs` or `massa-archival-api/src/server.rs`
- Routes: list periods, get block(s) by period/slot, get block by ID; return 404 when not archived or beyond retention.

**Security:** Bind to localhost by default; allow configurable bind address. Optional: API key or IP allowlist for production.

---

### Phase 7: Configuration Integration

#### 7.1 Node config

**File to modify:** `massa-node/base_config/config.toml`

Add sections:
```toml
[archival]
    enabled = false
    retention_periods = 100
    archive_operations = true
    storage_path = "archived_blocks"   # relative to node data dir or absolute
    replication_factor = 3
    chunk_size = 1048576   # 1MB
    allocated_storage_gb = 10
    challenge_frequency_periods = 100
    challenge_response_timeout_ms = 60000
    storage_registry_address = ""   # Smart contract address
```

**File to modify:** `massa-node/src/settings.rs` (or equivalent)

Parse `ArchivalConfig`; pass into archival worker and API (if in same process).

#### 7.2 API and protocol config

```toml
[archival.api]
    enabled = true          # only when archival.enabled is true
    bind_address = "127.0.0.1:4343"
    # optional: api_key, allowlist

# Protocol limits for storage messages (massa-protocol-exports)
# max_storage_messages_per_second, max_chunk_size, max_stored_chunks_per_node, etc.
```

---

## Data Flows

### 1. Archival Flow (no consensus changes)
```
Finalized block data available (event / storage read / optional storage-layer callback)
  ↓
Archival worker receives block (and optionally operations)
  ↓
Serialize and send to local backend (StoreBlock command)
  ↓
Backend writes to filesystem or RocksDB; enforces retention (prune old periods)
```

### 2. Chunking and Replication Flow (no consensus changes)
```
Archival worker has period data (from subscription/callback)
  ↓
ChunkingEngine: serialize → split into chunks → build Merkle tree
  ↓
ReplicationManager: deterministic assignment; this node keeps assigned chunks
  ↓
Chunk backend: store chunks + Merkle roots
  ↓
StorageHandler: announce chunks via ChunkAnnouncement on P2P
```

### 3. P2P Chunk Retrieval Flow
```
Node receives ChunkAnnouncement from peer
  ↓
Check if we are assigned to store this chunk (deterministic)
  ↓
If yes: send ChunkRequest to peer (or we already have it)
  ↓
Peer responds with ChunkResponse (data + Merkle proof)
  ↓
Verify Merkle proof → store in chunk backend
```

### 4. Challenge-Response Flow
```
Challenge manager: periodic trigger (every N periods)
  ↓
Select random nodes + chunks; send Challenge via P2P (challenge_id, chunk_id, nonce)
  ↓
Challenged node: retrieve chunk from backend → build Merkle proof + sign → send ChallengeProof
  ↓
Verifier: verify proof → call smart contract submitProof / issueChallenge
  ↓
Contract records result (CHALLENGE_PASSED / CHALLENGE_FAILED); used for reward eligibility
```

### 5. Reward Distribution Flow (challenge-before-rewards)
```
After all active providers have been challenged for the period
  ↓
Reward distributor calls storage_registry.distributeRewards(period, nodeAddresses)
  ↓
Contract reverts if any active provider was not challenged this period
  ↓
Per node that passed all challenges: reward = allocatedGb × rewardPerGbPerPeriod (no slashing)
  ↓
Providers call claimRewards() to transfer pending rewards
```

### 6. Retrieval Flow (API)
```
Client calls API: GET /archived/periods or GET /archived/blocks/{block_id}
  ↓
API server queries archival backend (list periods, get block by id/period/slot)
  ↓
Backend reads from local storage; returns data or 404
  ↓
API returns response (JSON list or binary block)
```

---

## Critical Files Reference

### Files to Create (New Modules)
1. `massa-archival-exports` (or `massa-distributed-storage-exports`): lib.rs, config.rs, types.rs
2. `massa-archival-worker` (or `massa-distributed-storage-worker`): worker.rs, backend.rs (block + chunk storage), chunking.rs, replication.rs, challenge.rs, rewards.rs, api.rs
3. `massa-distributed-storage-worker/src/smart_contract/client.rs` – Smart contract client (issueChallenge, submitProof, distributeRewards, getNodeInfo)
4. `massa-protocol-worker/src/handlers/storage_handler/` – mod.rs, messages.rs, propagation.rs, retrieval.rs
5. **Smart contract:** `smartContract/assembly/contracts/storage-registry.ts` (this repo; see Phase 5)

### Files to Modify (Integration Points)
1. **No consensus changes.** Optional: one subscription or callback in **storage/event layer** only (Phase 1.2)—not in `massa-consensus-worker`.
2. `massa-protocol-worker/src/messages.rs` – Add Storage message type
3. `massa-protocol-exports/src/settings.rs` – Add storage message limits
4. `massa-node/base_config/config.toml` – Add `[archival]` (with replication/challenge/SC fields) and `[archival.api]`
5. `massa-node/src/settings.rs` – Parse archival config; wire worker, API, protocol handler
6. `massa-db-exports` or node DB – Add column families for archived blocks and chunks (optional)

---

## Phased Implementation Timeline

### Phase 1: Local Archival Module (Weeks 1-2)
- Create archival exports and config (including replication/challenge/SC fields)
- Decide and implement finalized block source (event / storage read / minimal storage callback)—no consensus changes
- Implement local block backend + chunk backend (chunking engine, Merkle tree, replication manager)
- Unit tests for backend read/write/prune and chunking

### Phase 2: Archival Worker (Weeks 2-3)
- Worker that subscribes to finalized data; store blocks + chunk period data; replication assignment; announce chunks
- Retention pruning for blocks and chunks
- Integration test: feed blocks, verify blocks and chunks on disk/DB

### Phase 3: P2P Protocol (Weeks 3-4)
- Storage handler (propagation + retrieval); storage messages; protocol message enum
- Chunk request/response over P2P; rate limits in protocol config
- Network tests: chunk propagation between nodes

### Phase 4: Challenge System (Weeks 4-5)
- Challenge manager: issue challenges, verify proofs, call smart contract
- Proof generation when challenged
- Security tests: invalid proof rejection, replay prevention

### Phase 5: Smart Contract (Weeks 5-6)
- Storage registry contract (this repo: smartContract/); deployment
- Reward distribution logic (challenge-before-rewards); Rust client for SC calls
- Contract unit tests; integration: distributeRewards only after all providers challenged

### Phase 6: Retrieval API (Week 6-7)
- HTTP or gRPC server: list periods, get block by ID, get blocks by period/slot
- Bind to localhost by default; optional auth
- Tests: API returns archived blocks

### Phase 7: Configuration and polish (Weeks 7-8)
- Config integration; enable/disable archival, API, P2P storage, challenges
- Documentation for node operators
- Performance and edge cases (large retention, many chunks)

---

## Testing Strategy

### Unit Tests
- **Backend**: Write block/chunk, read by id/period/slot, list periods, prune by retention
- **Chunking**: Serialization, chunk split, Merkle tree generation
- **Replication**: Chunk assignment algorithm, rebalancing
- **Challenges**: Proof generation, verification, timing
- **Worker**: StoreBlock and ArchivePeriod; PruneOlderThan
- **API**: List/get endpoints return expected data
- **Smart contract**: Reward calculation, challenge-before-rewards revert when not all challenged

### Integration Tests
- **Archival flow**: Feed finalized blocks (subscription mock) → worker → block backend + chunk backend; verify retention
- **Replication flow**: Chunk announcement → request → storage
- **Challenge flow**: Challenge → proof → verification → SC update
- **Reward flow**: distributeRewards only after all providers challenged; claimRewards

### Network Tests
- Multi-node with storage enabled; chunk propagation; challenge-response over P2P
- **No consensus changes**: Verify consensus and protocol code paths unchanged when archival is enabled/disabled
---

## Security Considerations

1. **No consensus impact**: Archival and storage layer are **subscribers** or **read-only** on finalized data; **no modifications to `massa-consensus-worker`**. Protocol only gains a new message type and handler.
2. **Challenge-before-rewards**: Rewards distributable only after all active providers have been challenged for the period (contract reverts otherwise).
3. **No staking / no slashing**: Storage providers do not stake MAS; failed challenges result in no reward for that period (no slashing).
4. **Proof integrity**: Merkle proofs + signatures prevent fake storage claims; invalid proof rejection and replay prevention.
5. **API exposure**: Bind to localhost by default; configurable bind and optional auth for public nodes.
6. **Rate limiting**: Protocol limits on storage messages to prevent DoS.
---

## Performance Considerations

1. **I/O**: Batch writes per period; sequential writes for filesystem; chunk size (e.g. 1MB) balances granularity vs overhead.
2. **Retention**: Prune blocks and chunks in background to avoid blocking archival.
3. **P2P**: Storage messages low-priority (like operations); announce hashes, pull full data on-demand; rate limits.
4. **API**: Serve binary blocks without heavy parsing; optional compression for list endpoints.
5. **Challenges**: Frequency (e.g. every N periods) balances verification vs overhead.
6. **Disk space**: Document size per block/period/chunk so operators can size retention and allocated_storage_gb.

---

## Verification Plan

### How to Test End-to-End (no consensus changes)

1. **Enable archival on 3+ nodes** in testnet config (no changes to consensus code)
   ```toml
   [archival]
   enabled = true
   retention_periods = 10
   replication_factor = 3
   allocated_storage_gb = 1
   storage_registry_address = "AS1..."
   ```

2. **Obtain finalized blocks via subscription/callback** (event or storage layer)—verify consensus code is untouched. Watch logs for archival:
   ```
   [INFO] Archived period 100: 5 blocks, 123 operations, 15 chunks
   [INFO] Chunks assigned to nodes: node_A[5], node_B[5], node_C[5]
   ```

3. **Verify chunk propagation** over P2P (storage handler)
   ```bash
   massa-cli storage list-chunks
   # Should show chunks per node (replication factor)
   ```

4. **Trigger challenge** (via API or periodic trigger); verify proof submission and SC update
   ```
   [INFO] Challenge issued to node_A for chunk abc123
   [INFO] Proof received from node_A - VALID
   ```

5. **Check reward distribution** — only after all providers challenged for the period
   ```bash
   massa-cli sc call storage_registry get_node_info <node_id>
   # pending_rewards, lastChallengedPeriod, etc.
   ```

6. **Retrieval API** — list periods, get block by ID; verify response matches archived data.

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

## Storage Client as Separate Binary (Path to Yield Storage Platform)

### Goal

- Run the **storage layer independently** from the Massa node: a **separate binary** (`massa-storage-client`) that can be started, stopped, and configured on its own.
- **Data agnostic**: The storage client exposes a **generic data upload API**. **Storing Massa chain data (blocks and operations) is a special case**: only **storage admins** (Massalabs) can upload blockchain data; Massalabs will be the storage admin. **Anyone can upload data** for other namespaces (e.g. user cloud storage). This allows every node runner to **index** blockchain data (via the Read API) while keeping chain data canonical and trusted.
- **No consensus changes**: The node does not modify consensus; blockchain data is pushed to the storage client by Massalabs-authorized uploaders; node runners and others read/index via the Read API.
- **Future yield storage platform**: Same client: blockchain = storage-admin-only uploads; other data = anyone can upload; same chunking, P2P, challenge, and smart-contract machinery.

### Data-Agnostic Design: Upload API, Read API, Challenge Handling

The storage client exposes **three main surfaces**:

1. **Upload API (data ingestion)**  
   - **Endpoint**: e.g. `POST /upload` (or gRPC `Upload(data, namespace, id_hint?)`).  
   - **Contract**: The client accepts **arbitrary binary data** plus optional metadata (e.g. **namespace**, id). It does not interpret payloads; the uploader is responsible for serialization and naming.  
   - **Authorization (by namespace)**:
     - **Blockchain data (blocks and operations)** — **special case**: Uploads with namespace `blockchain` (or equivalent) **require** the signer to be a **storage admin** in the smart contract (`getIsStorageAdmin(addr) == 1`). **Massalabs will be the storage admin** (or will register addresses that can upload chain data). The client verifies the Massa signature and rejects with `403 Forbidden` if the signer is not a storage admin. This keeps chain data canonical and trusted; every node runner can then **index** (read) this data via the Read API.
     - **Other data** (e.g. user cloud storage): **Anyone can upload.** The client verifies the Massa signature (for authenticity) but does **not** require storage admin. So node runners and third parties can upload their own data; only blockchain uploads are restricted to Massalabs-authorized admins.
   - **Processing**: On success, the client stores the data (chunking, Merkle tree, retention), assigns chunk IDs, and participates in P2P replication as before.  
   - **Blockchain usage**: Massalabs (or an authorized uploader) pushes finalized blocks/operations to the upload API with namespace `blockchain` and a key registered as storage admin. Node runners and indexers **read** the stored chain data via the Read API; they do not need to be storage admins to index it.

2. **Read API (make data readable from outside)**  
   - **Endpoints**: e.g. `GET /data` (list stored items, optionally by namespace), `GET /data/{id}` (get raw data by ID).  
   - **Contract**: The client exposes stored data so that external clients (block explorers, indexers, users) can list and download by ID (and optionally namespace). Access control (if any) can be extended later (e.g. public vs. per-namespace); for block archival, list/get by block ID or period/slot is sufficient.  
   - **Implementation**: Backed by the same local storage (and optionally by fetching from P2P if the item is not local).

3. **Challenge handling**  
   - The client **handles challenges** issued by the network (or by a challenger service):  
     - Receives a challenge (e.g. chunk_id, nonce), typically via P2P or a dedicated challenge endpoint.  
     - Retrieves the corresponding chunk from local storage, builds the Merkle proof, signs the proof.  
     - Responds with the proof (e.g. sends `ChallengeProof` on P2P or to the challenger) and/or submits the result to the smart contract so that reward eligibility is updated.  
   - The client may also **issue challenges** to other providers (if it acts as a verifier), using the same protocol and SC.

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Massalabs / authorized uploader (blockchain data only)                  │
│  - Pushes blocks/ops to storage client with namespace=blockchain          │
│  - Must be registered as storage admin in SC (Massalabs is admin)        │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ POST /upload (namespace=blockchain; admin check)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  massa-storage-client (separate binary, data agnostic)                    │
│  - Upload API: if namespace=blockchain → require storage admin (Massalabs); │
│    else anyone can upload (signed). Then store (chunk, Merkle, retention) │
│  - Read API: list / GET /data/{id} (expose stored data)                  │
│  - Challenge handling: receive challenge, prove, respond / submit SC     │
│  - P2P (chunks), SC (rewards, admin list), own config and storage path   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              P2P (chunks)    Smart contract    Read API
              (replication,   (rewards,         (list, get by id)
               challenges)    storage admins)
```

### Smart Contract: Cloud Storage Admin (Blockchain Data Only)

The storage registry supports **storage admins** — addresses allowed to upload **blockchain data** (blocks and operations) to the storage client. **Massalabs will be the storage admin** (contract admin adds storage admins via `addStorageAdmin(addr)`). View `getIsStorageAdmin(addr)` lets the storage client verify uploaders for namespace `blockchain` only. **Anyone can upload** data in other namespaces without being a storage admin; the admin check applies only to the blockchain namespace. This allows every node runner to **index** (read) blockchain data from the storage layer while keeping who can *write* chain data restricted to Massalabs-authorized keys.

### How Blockchain Data Is Stored and Indexed (No Consensus Change)

- **Writing chain data**: Massalabs (or an address they register as storage admin) pushes finalized blocks/operations to the storage client with namespace `blockchain` and a signed payload. The client checks `getIsStorageAdmin(uploader)` and accepts only if true. No consensus code is modified; the uploader gets finalized data from the node/storage layer and calls the client's upload API.
- **Indexing chain data**: **Every node runner** (and any client) can **read** stored blockchain data via the Read API (`GET /data`, `GET /data/{id}`, optionally filtered by namespace `blockchain`). No storage admin role is required to read; only uploads of blockchain data are restricted to storage admins.


### Storage Client Binary: Scope and Delivery

- **Name**: `massa-storage-client` (or `massa-storage`).
- **Delivery**: Shipped **by default** with the Massa node (same release artifact or repo): e.g. `massa-node`, `massa-storage-client`, `massa-client` in one package.
- **Config**: Own config file (e.g. `storage_client.toml`):
  - `storage_path`, `retention_periods`, `replication_factor`, `chunk_size`, `allocated_storage_gb`, challenge params, `storage_registry_address` (for rewards and **storage admin list**), upload API bind address, read API bind address, P2P settings.
- **Responsibilities** (data agnostic):
  - **Upload API**: Accept signed uploads. For namespace **blockchain**: require `getIsStorageAdmin(uploader)` (Massalabs). For other namespaces: anyone can upload (signed). Then chunk, store, Merkle, replicate.
  - **Read API**: List and serve stored data by ID and optionally namespace — **every node runner can index** blockchain data (and other data) without being a storage admin.
  - **Challenge handling**: Respond to challenges (retrieve chunk, prove, respond/submit to SC); optionally issue challenges.
  - P2P chunk protocol, SC for rewards and storage admin list, own process and storage.

### Future: Yield Storage Platform (Same Client)

The same **storage client** binary and architecture can be extended so that:

- **Consumers**: Users/apps request **cloud storage** (e.g. “store this file”, “retrieve by ID”) and **pay in MAS** (e.g. per GB per period, via smart contract or off-chain agreement settled on-chain).
- **Providers**: Operators run `massa-storage-client` with “provide user storage” enabled; they allocate capacity and **earn MAS** when they pass challenges (same challenge/proof/reward machinery as block archival).
- **Unified stack**: Block archival and user storage share:
  - Chunking, Merkle trees, P2P replication, challenge-response, storage registry (or an extended contract), retrieval API.
- **Differences**: User storage needs: (1) a **namespace** (e.g. user_id + file_id) and access control; (2) **billing** (MAS per GB/time); (3) **contracts**: e.g. “storage market” contract for reservations and payments. The **client binary** stays one; it just gains a “mode” or “features” for user storage (config + optional contract endpoints).

By making the storage client a **separate binary** now, we keep the node focused on consensus and the storage layer focused on storage and incentives; adding yield storage later becomes an extension of the client and contracts, not a refactor of the node.

### Summary

| Aspect | Proposal |
|--------|----------|
| **Binary** | `massa-storage-client` — separate from `massa-node`, data agnostic, shipped together by default. |
| **Upload** | Generic **upload API** (signed). **Blockchain data** = special case: only **storage admins** (Massalabs) can upload; **other data** = anyone can upload. |
| **Read** | **Read API** to list and get data by ID/namespace — **every node runner can index** blockchain data (and other data). |
| **Challenges** | Client **handles challenges** (receive, prove, respond / submit to SC). |
| **SC** | **Storage admin** = for blockchain uploads only; Massalabs is the storage admin; `getIsStorageAdmin(addr)` used by client for namespace `blockchain`. |
| **No consensus** | Chain data is pushed by Massalabs-authorized uploaders; node runners index (read) via Read API; consensus unchanged. |
| **Future yield** | Same client + extended contracts for “pay MAS for storage” / “earn MAS for providing storage”; same chunking/P2P/challenge/reward stack. |

---

## Open Questions / Future Enhancements

1. **Data retrieval API**: How should users/apps query historical data from storage layer? (Covered by retrieval API; yield platform may add user-scoped endpoints.)
2. **Geographic diversity**: Track node locations for better replication distribution?
3. **Erasure coding**: More storage-efficient than full replication (future optimization)
4. **Dynamic rewards**: Adjust reward rate based on network storage supply/demand?
5. **Bootstrapping**: How do new nodes quickly sync historical data from storage layer?
6. **Storage client P2P**: Direct network between clients vs. relay through node — trade-offs (latency, firewall, reuse of node identity)?

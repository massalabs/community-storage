# Massa Storage Server

Simple storage server implementing the **upload** and **read** API from the [plan](../plan.md). Data is stored on the filesystem and indexed by namespace and id.

## Build and run

```bash
cd server
cargo build --release
./target/release/massa-storage-server
```

Environment variables:

- `STORAGE_LIMIT_GB` — **required**. Max total storage in GB; uploads rejected with 507 when exceeded.
- `STORAGE_PATH` — base directory for stored data (default: `./data`)
- `BIND_ADDRESS` — listen address (default: `127.0.0.1:4343`)
- `RUST_LOG` — log level (e.g. `info`, `debug`)
- P2P listen address is fixed (`/ip4/0.0.0.0/tcp/0`); the actual bound address is shown in logs when the P2P subsystem starts.
- `PRIVATE_KEY` — **required**. Massa private key (S12…); the provider address is derived from it.
- `STORAGE_REGISTRY_ADDRESS` — **required**. Storage registry contract address; server will not start if missing. Used for upload auth, provider list, and contract writes.
- `MASSA_JSON_RPC` — (required for upload auth) Massa JSON-RPC URL (e.g. `https://buildnet.massa.net/api/v2`).

**Provider registration:** With **`MASSA_GRPC_URL`** set (e.g. `grpc://buildnet.massa.net:33037`), the server **registers itself** as a storage node on startup. It checks whether its address (derived from `PRIVATE_KEY`) is already registered; if not, it calls `registerStorageNode(allocatedGb, endpoint, p2pAddrs)` using `STORAGE_LIMIT_GB`, the public endpoint, and the P2P multiaddrs discovered at runtime. If already registered, it only calls `updateProviderMetadata` to refresh the endpoint and P2P addresses. The endpoint advertised is `PUBLIC_ENDPOINT` if set, otherwise `http://BIND_ADDRESS`. No separate `register-provider` step is required. See `.env.example` for `BOOTSTRAP_PEERS`.

**Storage usage on contract:** After each successful upload, the server calls `recordFileUpload(uploader, size_bytes)` on the storage registry so total usage per uploader is tracked. This requires the server’s address (derived from `PRIVATE_KEY`) to be a **storage admin** on the contract (e.g. contract admin calls `addStorageAdmin(server_address)`).

When both `STORAGE_REGISTRY_ADDRESS` and `MASSA_JSON_RPC` are set, **POST /upload** requires auth (mode wallet uniquement) : le client envoie hex(Blake3(body)) au wallet pour signature, puis envoie `X-Massa-Address`, `X-Massa-Signature`, `X-Massa-Public-Key`. Le serveur vérifie la signature (Blake3(utf8(hex(Blake3(body)))) + Ed25519) et `getIsAllowedUploader(address)` sur le contrat ; seuls les uploaders enregistrés peuvent uploader. Utiliser le script `upload-file` avec `PRIVATE_KEY` ou `WALLET`, ou l’app front avec Bearby/Massa Station.

## API

### Upload

- **POST /upload**  
  Body: raw binary data.  
  Query:
  - `namespace` (optional, default: `default`) — e.g. `blockchain` for chain data
  - `id` (optional) — if omitted, a UUID is generated
  - `min_replication` (optional, default: `1`) — minimum number of replicas the uploader requires (1–32). Stored as per-blob metadata for when P2P replication is implemented.

  Headers (optional): `X-Min-Replication` — same as query param. When upload auth is enabled: `X-Massa-Address`, `X-Massa-Signature`, `X-Massa-Public-Key` are required.

Example:

```bash
curl -X POST "http://127.0.0.1:4343/upload?namespace=blockchain&id=block_123&min_replication=3" \
  --data-binary @block.bin
# -> 201 {"id":"block_123","namespace":"blockchain","min_replication":3}
```

### Read

- **GET /data**  
  List stored items.  
  Query: `namespace` (optional) — if omitted, list all namespaces.

  Response: JSON array of `{ "id", "namespace", "size", "created_at", "min_replication" }`.

- **GET /data/:id**  
  Get raw data by id in namespace `default`.

- **GET /data/:namespace/:id**  
  Get raw data by namespace and id.

Example:

```bash
curl "http://127.0.0.1:4343/data?namespace=blockchain"
curl "http://127.0.0.1:4343/data/blockchain/block_123" -o block.bin
```

### Config (storage limit and usage)

- **GET /config**  
  Returns JSON: `{ "storage_limit_gb", "storage_limit_bytes", "storage_used_bytes" }`. Available from the outside world to inspect the provider’s storage limit and current usage.

### Health

- **GET /health**  
  Returns `ok`.

## Data layout

Stored files live under `{STORAGE_PATH}/{namespace}/{id}`. Per-blob metadata (e.g. `min_replication`) is stored in `{STORAGE_PATH}/{namespace}/{id}.meta` (JSON). Namespace and id are sanitized (alphanumeric, `-`, `_` only). Listing is done by scanning the filesystem (no separate index DB in this simple version).

## Replication (uploader hint)

The server does **not** yet replicate data across nodes; that is planned (see plan). The upload API accepts a **minimum replication** value (1–32) so that:

- The uploader can require e.g. `min_replication=3` for important data.
- The value is stored in blob metadata (`{id}.meta`) and returned in the upload response and in list entries.
- When P2P replication is implemented, the system can enforce that each blob is replicated at least that many times before considering the upload satisfied (or before reporting success).

## Future (from plan)

This server is a minimal first step. The full plan adds:

- Massa-signed uploads and storage-admin check for namespace `blockchain`
- Chunking, Merkle trees, P2P replication, challenges, smart-contract rewards
- Retention and pruning

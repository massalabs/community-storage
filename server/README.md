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
- `P2P_LISTEN_ADDR` — libp2p listen multiaddr (default: `/ip4/0.0.0.0/tcp/0`)
- `MASSA_ADDRESS` — Massa address identifying this storage provider (used for logging/identity and future SC integration)
- `STORAGE_REGISTRY_ADDRESS` — (optional) Storage registry contract address. With `MASSA_JSON_RPC`, enables upload auth.
- `MASSA_JSON_RPC` — (optional) Massa JSON-RPC URL (e.g. `https://buildnet.massa.net/api/v2`). Required for upload auth.

When both `STORAGE_REGISTRY_ADDRESS` and `MASSA_JSON_RPC` are set, **POST /upload** requires the client to sign the body (Blake3 + Ed25519) and send `X-Massa-Address`, `X-Massa-Signature`, `X-Massa-Public-Key`. The server verifies the signature and calls `getIsStorageAdmin(address)` on the registry; only storage admins can upload. Use the `upload-file` script with `PRIVATE_KEY` or `WALLET` set.

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

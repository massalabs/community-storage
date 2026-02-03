# Massa Storage Server

Simple storage server implementing the **upload** and **read** API from the [plan](../plan.md). Data is stored on the filesystem and indexed by namespace and id.

## Build and run

```bash
cd server
cargo build --release
./target/release/massa-storage-server
```

Optional environment variables:

- `STORAGE_PATH` — base directory for stored data (default: `./data`)
- `BIND_ADDRESS` — listen address (default: `127.0.0.1:4343`)
- `RUST_LOG` — log level (e.g. `info`, `debug`)
- `P2P_LISTEN_ADDR` — libp2p listen multiaddr (default: `/ip4/0.0.0.0/tcp/0`)
- `MASSA_ADDRESS` — Massa address identifying this storage provider (used for logging/identity and future SC integration)

## API

### Upload

- **POST /upload**  
  Body: raw binary data.  
  Query:
  - `namespace` (optional, default: `default`) — e.g. `blockchain` for chain data
  - `id` (optional) — if omitted, a UUID is generated

Example:

```bash
curl -X POST "http://127.0.0.1:4343/upload?namespace=blockchain&id=block_123" \
  --data-binary @block.bin
# -> 201 {"id":"block_123","namespace":"blockchain"}
```

### Read

- **GET /data**  
  List stored items.  
  Query: `namespace` (optional) — if omitted, list all namespaces.

  Response: JSON array of `{ "id", "namespace", "size", "created_at" }`.

- **GET /data/:id**  
  Get raw data by id in namespace `default`.

- **GET /data/:namespace/:id**  
  Get raw data by namespace and id.

Example:

```bash
curl "http://127.0.0.1:4343/data?namespace=blockchain"
curl "http://127.0.0.1:4343/data/blockchain/block_123" -o block.bin
```

### Health

- **GET /health**  
  Returns `ok`.

## Data layout

Stored files live under `{STORAGE_PATH}/{namespace}/{id}`. Namespace and id are sanitized (alphanumeric, `-`, `_` only). Listing is done by scanning the filesystem (no separate index DB in this simple version).

## Future (from plan)

This server is a minimal first step. The full plan adds:

- Massa-signed uploads and storage-admin check for namespace `blockchain`
- Chunking, Merkle trees, P2P replication, challenges, smart-contract rewards
- Retention and pruning

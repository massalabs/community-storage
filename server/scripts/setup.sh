#!/bin/bash
set -e

cd "$(dirname "$0")/.."

NUM=${1:-3}
CONTRACT_DIR="$(cd ../smartContract && pwd)"
ENV_FILE="$CONTRACT_DIR/.env"

echo "=== Community Storage Setup ($NUM servers) ==="
echo ""

# 1. Register providers on blockchain
echo "[1/3] Registering providers..."
cd "$CONTRACT_DIR"
NUM_PROVIDERS=$NUM npm run setup --silent
cd - > /dev/null

# Load env vars
set -a; source "$ENV_FILE" 2>/dev/null || true; set +a

# Default contract address if not set
STORAGE_REGISTRY_ADDRESS="${STORAGE_REGISTRY_ADDRESS:-AS14XRdSCc87DZbMx2Zwa1BWK2R8WmwShFGnTtVa2RLDYyx2vwyn}"

# 2. Generate docker-compose.yml and start servers
echo ""
echo "[2/3] Starting servers..."

# Header (build context is parent dir to include rust-massa-web3)
cat > docker-compose.yml << 'EOF'
services:
EOF

# Services (no BOOTSTRAP_PEERS - peers discovered from smart contract)
for i in $(seq 1 $NUM); do
  ADDR_VAR="PROVIDER_${i}_ADDRESS"
  SECRET_VAR="PROVIDER_${i}_PRIVATE_KEY"
  PUBLIC_PORT=$((4342+i))

  cat >> docker-compose.yml << EOF
  storage-$i:
    build: .
    container_name: storage-$i
    ports: ["$PUBLIC_PORT:4343", "$((4000+i)):4001/tcp", "$((4000+i)):4001/udp"]
    environment:
      - MASSA_ADDRESS=${!ADDR_VAR:-}
      - STORAGE_LIMIT_GB=${STORAGE_LIMIT_GB:-1}
      - RUST_LOG=info
      - CONTRACT_ADDRESS=${STORAGE_REGISTRY_ADDRESS:-}
      - MASSA_RPC_URL=${MASSA_RPC_URL:-https://buildnet.massa.net/api/v2}
      - MASSA_GRPC_URL=${MASSA_GRPC_URL:-grpc://buildnet.massa.net:33037}
      - PRIVATE_KEY=${!SECRET_VAR:-}
      - PUBLIC_ENDPOINT=http://localhost:$PUBLIC_PORT
    volumes: [storage-$i-data:/app/data]
    healthcheck: {test: ["CMD", "curl", "-f", "http://localhost:4343/health"], interval: 10s, timeout: 3s, retries: 3}
EOF
done

# Volumes
echo "volumes:" >> docker-compose.yml
for i in $(seq 1 $NUM); do echo "  storage-$i-data:" >> docker-compose.yml; done

# Start
docker compose up -d --build 2>&1 | grep -v "pull" || true

# Wait
echo -n "Health check"
for _ in $(seq 1 30); do
  [ "$(docker compose ps --format json 2>/dev/null | grep -c healthy || echo 0)" -ge "$NUM" ] && break
  sleep 1; echo -n "."
done
echo ""

# Status
echo ""
docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null

# 3. P2P address registration happens automatically in Rust server
echo ""
echo "[3/3] P2P addresses will be registered automatically by each server..."
echo "      (wait ~5 seconds for servers to register their addresses)"
sleep 5

# Show P2P info
echo ""
echo "P2P Status:"
for i in $(seq 1 $NUM); do
  echo -n "  storage-$i: "
  curl -s "http://localhost:$((4342+i))/peers" 2>/dev/null | grep -o '"local_peer_id":"[^"]*"' | head -1 || echo "not ready"
done

echo ""
echo "Done! Stop: ./scripts/teardown.sh"

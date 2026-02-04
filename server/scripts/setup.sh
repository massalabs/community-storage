#!/bin/bash
set -e

cd "$(dirname "$0")/.."

NUM=${1:-3}
CONTRACT_DIR="$(cd ../smartContract && pwd)"
ENV_FILE="$CONTRACT_DIR/.env"

echo "=== Community Storage Setup ($NUM servers) ==="
echo ""

# 1. Register providers on blockchain
echo "[1/2] Registering providers..."
cd "$CONTRACT_DIR"
NUM_PROVIDERS=$NUM npm run setup --silent
cd - > /dev/null

# Load env vars
set -a; source "$ENV_FILE" 2>/dev/null || true; set +a

# 2. Generate docker-compose.yml
echo ""
echo "[2/2] Starting servers..."

# Header
cat > docker-compose.yml << 'EOF'
services:
EOF

# Services
for i in $(seq 1 $NUM); do
  ADDR_VAR="PROVIDER_${i}_ADDRESS"
  cat >> docker-compose.yml << EOF
  storage-$i:
    build: .
    container_name: storage-$i
    ports: ["$((4342+i)):4343", "$((4000+i)):4001"]
    environment: [MASSA_ADDRESS=${!ADDR_VAR:-}, STORAGE_LIMIT_GB=${STORAGE_LIMIT_GB:-1}, RUST_LOG=info]
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
echo ""
echo "Stop: ./scripts/teardown.sh"

#!/bin/bash
# Check P2P connectivity status of running storage servers

cd "$(dirname "$0")/.."

echo "=== Storage Servers P2P Status ==="
echo ""

# Get running containers
CONTAINERS=$(docker compose ps --format "{{.Name}}" 2>/dev/null | sort)

if [ -z "$CONTAINERS" ]; then
  echo "No containers running. Start with: ./scripts/setup.sh"
  exit 1
fi

# Show status for each container
for CONTAINER in $CONTAINERS; do
  # Extract port from container name (storage-1 -> 4343, storage-2 -> 4344, etc.)
  NUM=$(echo "$CONTAINER" | grep -o '[0-9]*$')
  PORT=$((4342+NUM))

  echo "$CONTAINER (http://localhost:$PORT):"

  PEERS_JSON=$(curl -s "http://localhost:$PORT/peers" 2>/dev/null || echo "{}")

  if [ "$PEERS_JSON" = "{}" ] || [ -z "$PEERS_JSON" ]; then
    echo "  Status: NOT RESPONDING"
    echo ""
    continue
  fi

  PEER_ID=$(echo "$PEERS_JSON" | grep -o '"local_peer_id":"[^"]*"' | cut -d'"' -f4)
  CONNECTED_COUNT=$(echo "$PEERS_JSON" | grep -o '"peer_id":' | wc -l | tr -d ' ')

  echo "  Peer ID: ${PEER_ID:0:30}..."
  echo "  Connected peers: $CONNECTED_COUNT"
  echo ""
done

# Summary
TOTAL=$(echo "$CONTAINERS" | wc -w | tr -d ' ')
HEALTHY=$(docker compose ps 2>/dev/null | grep -c "(healthy)" || echo 0)

echo "=== Summary ==="
echo "Total: $TOTAL containers"
echo "Healthy: $HEALTHY"
echo "Expected connections per node: $((TOTAL-1))"

#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "=== Stopping Massa Storage Test Network ==="

docker compose down 2>/dev/null || echo "Nothing to stop"

echo ""
echo "Done. Volumes preserved."
echo "To delete volumes: docker compose down -v"

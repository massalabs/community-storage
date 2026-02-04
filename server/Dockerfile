# Stage 1: Build
FROM rust:latest AS builder

WORKDIR /app

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock ./

# Create dummy src to cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release || true
RUN rm -rf src

# Copy actual source and rebuild
COPY src ./src
RUN touch src/main.rs && cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

# Install runtime dependencies for libp2p (OpenSSL, CA certs) and curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 storage

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/target/release/massa-storage-server /app/massa-storage-server

# Create data directory
RUN mkdir -p /app/data && chown -R storage:storage /app

USER storage

# Environment defaults (STORAGE_LIMIT_GB must be provided at runtime)
ENV STORAGE_PATH=/app/data
ENV BIND_ADDRESS=0.0.0.0:4343
ENV P2P_LISTEN_ADDR=/ip4/0.0.0.0/tcp/4001
ENV RUST_LOG=info

EXPOSE 4343
EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:4343/health || exit 1

CMD ["./massa-storage-server"]

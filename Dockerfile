FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f

RUN apk add --no-cache su-exec

WORKDIR /app

ENV PORT=3000 \
    CACHE_DIR=/app/cache \
    TOKENS_DB_PATH=/app/data/nx-cache-server-tokens.sqlite \
    STORAGE_STRATEGY=filesystem

# Install runtime dependencies first so this layer caches independently of source.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src
COPY docker-entrypoint.sh docker-healthcheck.ts ./

# Create the writable image-local data/cache directories. Runtime mounts are
# prepared by docker-entrypoint.sh before it drops to the `bun` user. Everything
# else in /app stays root-owned: root runs the entrypoint on every restart.
RUN chmod +x /app/docker-entrypoint.sh \
    && mkdir -p "$CACHE_DIR" "$(dirname "$TOKENS_DB_PATH")" \
    && chown bun:bun "$CACHE_DIR" "$(dirname "$TOKENS_DB_PATH")"

EXPOSE 3000

# Probe logic: see docker-healthcheck.ts. Health checks skip the entrypoint, so
# drop to `bun` here too so the probe never runs as root.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/bin/sh", "-c", "if [ \"$(id -u)\" = 0 ]; then exec su-exec bun:bun bun /app/docker-healthcheck.ts; fi; exec bun /app/docker-healthcheck.ts"]

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["bun", "/app/src/main.ts"]

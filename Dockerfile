FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0

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

# Create the writable data/cache directories and hand ownership to the
# unprivileged `bun` user (uid 1000) that ships with the base image, so the
# server never runs as root.
RUN mkdir -p "$CACHE_DIR" "$(dirname "$TOKENS_DB_PATH")" \
    && chown -R bun:bun /app

USER bun

EXPOSE 3000
CMD ["bun", "/app/src/main.ts"]

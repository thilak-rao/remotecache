#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  cache_dir=${CACHE_DIR:-/app/cache}
  tokens_db_path=${TOKENS_DB_PATH:-/app/data/nx-cache-server-tokens.sqlite}
  tokens_db_dir=$(dirname "$tokens_db_path")

  mkdir -p "$cache_dir" "$tokens_db_dir"

  if [ "$cache_dir" != "/" ]; then
    chown bun:bun "$cache_dir"
  fi

  if [ "$tokens_db_dir" != "/" ]; then
    chown bun:bun "$tokens_db_dir"
  fi

  if [ -e "$tokens_db_path" ]; then
    chown bun:bun "$tokens_db_path"
  fi

  exec su-exec bun:bun "$@"
fi

exec "$@"

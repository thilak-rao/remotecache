#!/bin/sh
set -eu

# Root chowns these paths on every start, and the bun user can write inside
# them, so a symlink planted by bun would hand root's chown to its target.
refuse_symlink() {
  if [ -L "$1" ]; then
    echo "docker-entrypoint: refusing to chown symlink $1" >&2
    exit 1
  fi
}

if [ "$(id -u)" = "0" ]; then
  cache_dir=${CACHE_DIR:-/app/cache}
  tokens_db_path=${TOKENS_DB_PATH:-/app/data/nx-cache-server-tokens.sqlite}
  tokens_db_dir=$(dirname "$tokens_db_path")

  refuse_symlink "$cache_dir"
  refuse_symlink "$tokens_db_dir"
  refuse_symlink "$tokens_db_path"

  mkdir -p "$cache_dir" "$tokens_db_dir"

  if [ "$cache_dir" != "/" ]; then
    chown bun:bun "$cache_dir"
  fi

  if [ "$tokens_db_dir" != "/" ]; then
    chown bun:bun "$tokens_db_dir"
  fi

  if [ -e "$tokens_db_path" ] || [ -L "$tokens_db_path" ]; then
    chown -h bun:bun "$tokens_db_path"
  fi

  exec su-exec bun:bun "$@"
fi

exec "$@"

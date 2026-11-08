#!/bin/sh
set -e

# TMDB_API_KEY 由 server.js 读取，通过 /tmdb 同源代理访问 TMDb，不再写进前端
if [ -z "$TMDB_API_KEY" ]; then
  echo "[Warn] TMDB_API_KEY not set; TMDb sections will be empty."
fi

if [ -z "$ADMIN_PASSWORD" ]; then
  echo "[Warn] ADMIN_PASSWORD not set; using default 'admin'."
fi

exec node server.js

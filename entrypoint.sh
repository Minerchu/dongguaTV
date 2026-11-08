#!/bin/sh
set -e

# 把 TMDB_API_KEY 注入到前端（前端代码里是占位符）
if [ -n "$TMDB_API_KEY" ]; then
  echo "[Init] Injecting TMDB_API_KEY into index.html"
  sed -i "s|const TMDB_API_KEY = \".*\";|const TMDB_API_KEY = \"$TMDB_API_KEY\";|" /app/public/index.html
else
  echo "[Init] TMDB_API_KEY not set; front-end will use the placeholder."
fi

if [ -z "$ADMIN_PASSWORD" ]; then
  echo "[Warn] ADMIN_PASSWORD not set; using default 'admin'."
fi

exec node server.js

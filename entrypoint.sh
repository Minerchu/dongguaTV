#!/bin/sh

# 替换 index.html 中的 TMDB_API_KEY 行
if [ -n "$TMDB_API_KEY" ]; then
  echo "Injecting TMDB_API_KEY into index.html"
  sed -i "s|const TMDB_API_KEY = \".*\";|const TMDB_API_KEY = \"$TMDB_API_KEY\";|" /app/public/index.html
else
  echo "Warning: TMDB_API_KEY not set. Keeping original placeholder in index.html."
fi

# ADMIN_PASSWORD 由 server.js 直接读取环境变量，无需改写源码
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "⚠️ ADMIN_PASSWORD not set. Using default password 'admin'."
fi

# 启动应用
exec npm start -- --port="${PORT:-3000}"
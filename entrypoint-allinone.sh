#!/bin/sh
set -e

PANSOU_PORT="${PANSOU_PORT:-8888}"
PANSOU_BIN="${PANSOU_BIN:-/app/pansou}"

if [ "${PANSOU_EMBED:-1}" = "1" ] && [ -x "$PANSOU_BIN" ]; then
  echo "[PanSou] starting on 0.0.0.0:${PANSOU_PORT}"
  # 只覆盖端口；CHANNELS / ENABLED_PLUGINS / CACHE_PATH 等沿用官方镜像的默认值
  PORT="$PANSOU_PORT" "$PANSOU_BIN" &
else
  echo "[PanSou] embedded service disabled (PANSOU_EMBED=0)"
fi

# 应用默认连本机的 PanSou；如果显式传了 PANSOU_URL 就尊重它
export PANSOU_URL="${PANSOU_URL:-http://127.0.0.1:${PANSOU_PORT}}"

exec /app/entrypoint.sh

#!/usr/bin/env bash
# CITY20 本地完整演示：后端 FastAPI(8001) + 前端静态包(3300)
# 用法：bash scripts/local-demo.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ 启动后端 :8001"
cd "$ROOT/backend"
lsof -tiTCP:8001 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
nohup .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --log-level warning \
  > /tmp/city20-api.log 2>&1 &

echo "→ 启动前端 :3300"
lsof -tiTCP:3300 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
nohup python3 -m http.server 3300 --bind 127.0.0.1 --directory "$ROOT/frontend/out" \
  > /tmp/city20-web.log 2>&1 &

sleep 3
printf "  api: "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8001/healthz
printf "  web: "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3300/
open -a "Microsoft Edge" "http://127.0.0.1:3300/"
echo "已打开 http://127.0.0.1:3300/"

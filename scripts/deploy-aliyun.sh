#!/usr/bin/env bash
# 把后端部署到阿里云 ECS（8.133.225.105），并挂到 nginx 的 /city20/ 前缀
# 用法：bash scripts/deploy-aliyun.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${CITY20_HOST:-aliyun-ecs}"
REMOTE_DIR=/root/city20

echo "→ 打包后端"
cd "$ROOT"
tar czf /tmp/city20-backend.tgz backend/app backend/sim-config.yaml backend/pyproject.toml data/parcels/beijing_core
scp -q /tmp/city20-backend.tgz "$HOST:/tmp/"

echo "→ 远端解压 + 建 venv + 装依赖"
ssh "$HOST" 'set -e
rm -rf /root/city20/backend && mkdir -p /root/city20 && tar xzf /tmp/city20-backend.tgz -C /root/city20
[ -x /root/city20/venv/bin/pip ] || /usr/bin/python3.11 -m venv /root/city20/venv
/root/city20/venv/bin/pip install -q --upgrade pip
/root/city20/venv/bin/pip install -q fastapi "uvicorn[standard]" pydantic pydantic-settings pyyaml sse-starlette aiosqlite httpx'

echo "→ 重启服务"
ssh "$HOST" 'pkill -f "uvicorn app.main:app" 2>/dev/null || true; sleep 1
cd /root/city20/backend && nohup ../venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 17800 --log-level warning > /root/city20/api.log 2>&1 &
sleep 5; curl -s -o /dev/null -w "local:%{http_code}\n" http://127.0.0.1:17800/healthz'

echo "→ 公网验证"
curl -s -m 10 -o /dev/null -w "public:%{http_code}\n" http://8.133.225.105/city20/healthz
echo "完成：http://8.133.225.105/city20/healthz"

#!/usr/bin/env bash
# CITY20 一键发布到阿里云 ECS（8.133.225.105 / https://city20.tqym16.cn/）
#
# 重要约束：本脚本【不打包、不覆盖 data/parcels 地图数据】。
# 服务器上的 /root/city20/data/parcels 与 /root/city20/frontend/out/data/parcels
# 保持现状，只更新代码与其它静态资源。地图是用户明确要求“不要动”的部分。
#
# 用法：
#   bash scripts/deploy-aliyun.sh              # 完整发布（构建静态包 → 上传 → 重启 → 验证）
#   bash scripts/deploy-aliyun.sh --skip-build # 复用已有 frontend/out，只上传
#   CITY20_HOST=other-host bash scripts/deploy-aliyun.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${CITY20_HOST:-aliyun-ecs}"
SKIP_BUILD=0
if [ "${1:-}" = "--skip-build" ]; then SKIP_BUILD=1; fi

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "→ [1/5] 构建前端静态包（同源 API 模式）"
  cd "$ROOT/frontend"
  NEXT_PUBLIC_OFFLINE=1 NEXT_PUBLIC_API_MODE=real npm run build
fi

echo "→ [2/5] 打包代码（排除 data/parcels，地图数据保持服务器现状）"
cd "$ROOT"
rm -f /tmp/city20-code.tgz /tmp/city20-web.tgz
tar czf /tmp/city20-code.tgz \
  backend/app backend/sim-config.yaml backend/pyproject.toml backend/uv.lock \
  scripts/backup_db.py 2>/dev/null
tar czf /tmp/city20-web.tgz --exclude='./data/parcels' --exclude='data/parcels' \
  -C frontend/out . 2>/dev/null
if tar tzf /tmp/city20-web.tgz | grep -q 'parcels'; then
  echo "✗ 静态包仍包含 parcels，终止（避免覆盖地图数据）" >&2
  exit 1
fi
echo "  代码包 $(du -h /tmp/city20-code.tgz | cut -f1)，静态包 $(du -h /tmp/city20-web.tgz | cut -f1)，均不含 parcels"

echo "→ [3/5] 上传"
scp -q /tmp/city20-code.tgz /tmp/city20-web.tgz "$HOST:/tmp/"

echo "→ [4/5] 远端解包 + 重启服务"
ssh "$HOST" 'set -e
  cd /root/city20
  mkdir -p backend frontend/out logs
  tar xzf /tmp/city20-code.tgz -C /root/city20 2>/dev/null
  tar xzf /tmp/city20-web.tgz -C /root/city20/frontend/out 2>/dev/null
  [ -x venv/bin/pip ] || /usr/bin/python3.11 -m venv venv
  venv/bin/pip install -q --upgrade pip
  venv/bin/pip install -q -e backend 2>/dev/null \
    || venv/bin/pip install -q fastapi "uvicorn[standard]" pydantic pydantic-settings pyyaml sse-starlette aiosqlite httpx
  systemctl restart city20-api
  sleep 4
  systemctl is-active city20-api
  echo "  out/index.html: $(stat -c %y frontend/out/index.html)"
  echo "  data/parcels:   $(stat -c %y data/parcels) (应保持旧时间)"'

echo "→ [5/5] 线上验证"
curl -sf -m 10 https://city20.tqym16.cn/healthz && echo
curl -sf -m 10 -o /dev/null -w "  首页 HTTP %{http_code}\n" https://city20.tqym16.cn/
echo "完成：https://city20.tqym16.cn/"

# backend/

FastAPI 后端：确定性模拟引擎（[03](../docs/plan/03-sim-engine.md)）+ AI 叙述层编排（[04](../docs/plan/04-ai-roles.md)）+ SSE 推送。对前端只暴露 [02 契约](../docs/plan/02-data-contract.md)。

当前状态：契约模型与确定性地块生成已落地；REST、SSE、完整 sim 和 AI 编排按 [PR 任务卡](../docs/plan/08-pr-tasks.md) 逐步接入。

## 目录骨架（06 §2）

```
app/
├── main.py            # FastAPI 入口：挂路由、中间件、异常处理器
├── config.py          # 环境变量 + 参数文件加载（03 §8 的唯一出处）
├── contracts/         # Pydantic 模型，逐字段对应 02 文档
├── api/               # REST 路由层（PR-03）
├── core/              # 会话对象 / 注册表 / 阶段调度器（PR-03 起）
├── sim/               # 世界生成 + 全量重算 + 推演（PR-02 起）
├── narrate/           # AI 三角色编排 + 降级模板（PR-09 起）
└── sse/               # broadcaster / 断点补发（PR-13）
tests/
├── contract/          # 02 契约样例测试
├── sim/               # 黄金样例（固定布局→固定指标）
└── narrate/           # 降级链路 / 节流测试
```

## 本地开发

```bash
# 安装（含 dev 依赖）
pip install -e ".[dev]"

# 代码质量
ruff check .
pytest -q

# 起服务（当前提供健康检查；完整路由按任务卡接入）
uvicorn app.main:app --reload --port 8000
```

健康检查：`GET http://127.0.0.1:8000/healthz`。

依赖与虚拟环境不要装进项目卷（`.venv/` 已被 gitignore；设备级规范要求放 `$BUILD_SCRATCH_ROOT`）。

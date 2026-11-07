# 06 · 后端方案（FastAPI 数值与编排核心）

> 后端开发者按本文档施工。对前端只暴露 [02 契约](02-data-contract.md)；内部模块划分允许自由调整，但分层边界（§2）不可乱。

## 1. 技术选型（已定，不再纠结）

| 层 | 选型 | 理由 |
|---|---|---|
| 语言/运行时 | Python ≥3.11 | 数值原型迭代最快；48h 比赛节奏里开发速度优先 |
| 框架 | FastAPI（现行稳定版） | 契约校验天然贴合 Pydantic；生态成熟 |
| 数据校验 | Pydantic v2 | 请求/响应模型即契约文档，前后端字段名一一对应 02 文档 |
| SSE | sse-starlette | FastAPI SSE 事实标准（已核查） |
| 包管理 | uv | 速度碾压 pip；生成 requirements 锁文件供 CI |
| 配置 | 环境变量（pydantic-settings）+ YAML 参数文件 | 密钥走 env，平衡参数走 YAML（进 git） |
| 测试 | pytest | 契约测试 + sim 单测 |
| 进程模型 | 单进程单实例（uvicorn 单 worker） | 比赛场景单实例够用；会话态在内存，避免跨进程一致性麻烦 |

明确不用的：数据库（会话放内存 + 进程重启即丢，够用且零依赖）、Redis（同上）、ORM（没有库表）、Celery（定时用 asyncio 任务即可）。

## 2. 模块分层（目录骨架）

```
backend/
├── app/
│   ├── main.py            # FastAPI 入口：挂路由、中间件、异常处理器
│   ├── config.py          # 环境变量 + 参数文件加载（03 §8 的唯一出处）
│   ├── contracts/         # Pydantic 模型，逐字段对应 02 文档（文件名=数据形状）
│   │   ├── parcel.py  tile.py  metrics.py  events.py  errors.py
│   ├── api/               # REST 路由层：只做参数接收/校验/调用服务/装信封
│   │   ├── sessions.py    # 02 §3 全部端点
│   │   └── stream.py      # SSE 端点
│   ├── core/
│   │   ├── session.py     # 会话对象：地块+已放区块+指标+阶段+事件缓冲
│   │   ├── store.py       # 会话注册表：id→会话，内存 dict + 过期清理
│   │   └── timer.py       # 阶段调度器：briefing/build/polish 的倒计时与阶段切换
│   ├── sim/
│   │   ├── generator.py   # 03 §2 世界生成
│   │   ├── engine.py      # 03 §3-4 校验与全量重算
│   │   ├── projection.py  # 03 §6 十年推演
│   │   ├── endings.py     # 03 §7 结局判定
│   │   ├── events.py      # 03 §7 环境事件池
│   │   └── templates.py   # 04 §6 降级文案库（模板槽位）
│   ├── narrate/
│   │   ├── router.py      # 触发规则→决定调哪个角色；节流、合并、丢弃策略
│   │   ├── roles.py       # 三角色：组装上下文、调模型、解析、失败降级
│   │   ├── llm.py         # OpenAI 兼容客户端封装（统一 chat/completions 形状）
│   │   └── personas.py    # 市民人设、导师理论库等静态素材
│   └── sse/
│       ├── broadcaster.py # 事件入队、按会话广播、200 条环形缓冲、心跳
│       └── replay.py      # Last-Event-ID 断点补发
├── sim-config.yaml        # 03 §8 参数表落盘
├── tests/
│   ├── contract/          # 按 02 文档逐端点、逐事件类型的样例测试
│   ├── sim/               # 03 公式单测（含黄金样例：固定布局→固定指标）
│   └── narrate/           # 降级链路、节流、解析失败的测试
└── pyproject.toml
```

分层规则：api 层不碰 sim 内部；sim 层不 import narrate（单向依赖：api → sim / narrate → sse → store，core 被所有人依赖但不依赖任何人）。`llm.py` 是 narrate 与具体模型之间的唯一缝隙，换模型只动它。

## 3. 会话生命周期

| 阶段 | 行为 |
|---|---|
| 创建 | POST /sessions：用 seed 生成地块（sim.generator）→ 建会话对象 → 立即返回（briefing 文案先给模板版；AI 版异步生成后不入库，前端不从 REST 等它） |
| 进行 | 内存对象承载一切；每次操作走「校验→变更→全量重算→广播 tick→narrate.router 异步派发」 |
| 过期 | 创建后 40 分钟无操作 → 从注册表清除（无持久化，重启即清，比赛可接受） |
| 并发 | 单会话一把锁串行化所有操作（asyncio.Lock）；SSE 订阅只读，不加锁 |

## 4. SSE 实现要点（对齐 02 §3.8）

- 每会话一个 broadcaster：事件先进环形缓冲（200 条）再推给活跃订阅生成器。
- 心跳：定时任务每 15s 发空 delta 的 tick，同时兼作时间基准校正源。
- 断点补发：客户端带 Last-Event-ID 时，从缓冲里找该 id 之后的事件补发；不在缓冲范围内则从当前快照发一条全量 tick + phase_change 重置前端。
- 阶段切换、news/citizen/mentor、projection_step、report_ready 全部走同一 broadcaster，事件 id 单调递增。

## 5. AI 编排层（narrate）

- **入口**：sim 重算后产出 MetricsDiff → router 按 [04](04-ai-roles.md) §2-4 的触发规则与节流判定是否需要调用角色；需要则把任务丢进 asyncio 队列（每会话深度 ≤3，超出丢弃并触发模板兜底）。
- **调用**：roles 组装系统提示词 + 上下文（指标快照 + diff + 防复读样本 + 注入防护声明），经 llm.py 发送；超时 news/citizen 8s、mentor 20s。
- **解析**：按 02 §3.8 各事件的 data 形状校验（Pydantic）；失败重试 1 次；再败走 templates.py 模板。
- **回推**：成功/模板文案都走同一个 broadcaster，前端无感知。
- **隔离**：llm.py 任何异常都不冒泡到 api 层；llm 整体不可用时 router 直接走模板分支，游戏功能零影响。

## 6. 幂等与一致性

- place/remove/advance/finalize 均在后端串行执行（§3 锁），天然幂等于会话内。
- 前端重复提交同一 place（双击/重试）：以「格占用校验」天然兜底——第一次成功后第二次返回 409 cell_occupied，前端按错误协议展示即可。
- finalize 只允许生效一次：会话内记 finalized 标志，重复调用直接返回首次结果（投影是纯函数，结果相同）。

## 7. 观测与日志

- 结构化日志（JSON 行）：每次操作记 session_id / 端点 / 耗时 / 结果；narrate 记角色 / 模型 / 时延 / 是否降级。比赛现场排障全靠它。
- GET /healthz：返回进程存活 + 会话数 + 配置摘要（脱敏），供部署脚本探活。

## 8. 后端验收标准（DoD，逐条打勾）

1. 02 契约全部端点与事件类型按样例测试全绿；错误协议 9 个 code 逐一命中过。
2. 相同 seed + 相同操作序列，两次运行最终 projection 逐字段一致（确定性测试）。
3. finalize 在 48×48 满布局最坏情况下 <2s（契约性能）。
4. 全量重算 <10ms（抽样 100 次取 p95）。
5. 关闭所有 LLM 环境变量后：完整一局可玩、事件流有模板文案、报告有模板叙事（降级演示）。
6. SSE 断连 30 秒内重连可补发；缓冲溢出边界（断 200 条以上）按当前快照恢复。
7. sim-config.yaml 每个参数改值后，行为变化符合 03 文档语义（参数化抽查 5 项）。
8. /healthz 可访问且不泄露密钥。

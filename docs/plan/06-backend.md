# 06 · 后端方案（FastAPI 数值与编排核心）

> 后端开发者按本文档施工。对前端只暴露 [02 契约](02-data-contract.md)；内部模块划分允许自由调整，但分层边界（§2）不可乱。
> ⚠️ **存档体系变更（m00594）**：内存会话 + 40min TTL + 倒计时 timer 被 SQLite 事件溯源存档体系取代（不限时、多端同步、op_applied 广播），以 [10](10-persistence-sync.md) 为准；真实片区加载与 redevelop 见 [11](11-real-beijing-3d.md)。

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
| 持久化 | SQLite（WAL）+ aiosqlite | 单文件 `data/city20.db`；saves/ops/snapshots/reports 事件溯源，数据库是唯一事实源 |
| 进程模型 | 单进程单实例（uvicorn 单 worker） | per-save asyncio.Lock 与 SSE 扇出只在单进程内协调；内存仅作热点缓存，重启后从 SQLite 恢复 |

明确不用的：外部数据库服务、Redis、Celery，以及任何把内存当作存档事实源的设计。数据访问使用参数化 aiosqlite，不强制引入 ORM；备份使用 SQLite 在线安全备份能力，不直接复制正在写入的 WAL 文件。

## 2. 模块分层（目录骨架）

```
backend/
├── app/
│   ├── main.py            # FastAPI 入口：只挂 saves v2 路由、中间件、异常处理器
│   ├── config.py          # 环境变量 + 参数文件加载（03 §8 的唯一出处）
│   ├── contracts/         # Pydantic 模型，逐字段对应 02 文档（文件名=数据形状）
│   │   ├── parcel.py  tile.py  metrics.py  save.py  operation.py
│   │   ├── projection.py  report.py  events.py  errors.py
│   ├── api/               # REST 路由层：只做参数接收/校验/调用服务/装信封
│   │   ├── saves.py       # 02 §3 全部 create/get/start/operations/project/report/mentor
│   │   └── events.py      # GET /api/saves/{city_code}/events
│   ├── core/
│   │   ├── city_state.py  # 完整 CityState；热点缓存不是事实源
│   │   └── locks.py       # per-save asyncio.Lock，串行化同一存档写操作
│   ├── persistence/
│   │   ├── db.py          # aiosqlite 连接、WAL、事务与城市码唯一约束
│   │   ├── repository.py  # saves/ops/snapshots/reports；幂等结果、快照与增量重放
│   │   └── backup.py      # SQLite 在线安全备份与恢复校验
│   ├── sim/
│   │   ├── generator.py   # 03 §2 沙盒世界生成
│   │   ├── parcel_loader.py # 默认真实北京数据包加载与 data_version 校验
│   │   ├── engine.py      # 03 §3-4 校验与全量重算（含 redevelop）
│   │   ├── annual.py      # advance 与 project 共用的确定性年度步进
│   │   ├── projection.py  # 03 §6 快照副本上的只读推演
│   │   ├── endings.py     # 当前报告快照的城市体检标签判定（字段名 ending）
│   │   ├── events.py      # 03 §7 环境事件池
│   │   └── templates.py   # 04 §6 降级文案库（模板槽位）
│   ├── narrate/
│   │   ├── router.py      # 提交后触发；8s 节流、敏感度路由、每 10 领域 op/主动导师
│   │   ├── roles.py       # 三角色：组装上下文、调模型、解析、失败降级
│   │   ├── llm.py         # OpenAI 兼容客户端封装（统一 chat/completions 形状）
│   │   └── personas.py    # 市民人设、导师理论库等静态素材
│   └── sse/
│       ├── broadcaster.py # 按 city_code 广播、200 条环形缓冲、15s comment 心跳
│       └── replay.py      # Last-Event-ID 补发；溢出/重启不确定时发 snapshot
├── sim-config.yaml        # 03 §8 参数表落盘（不含现实倒计时）
├── data/city20.db         # 本地 SQLite 存档（运行产物，不进 git）
├── tests/
│   ├── contract/          # 按 02 文档逐端点、逐事件类型的样例测试
│   ├── persistence/       # 重放、快照、幂等、project 零写入、重启与备份恢复
│   ├── sim/               # 03 公式单测（含黄金样例：固定布局→固定指标）
│   └── narrate/           # 降级链路、节流、解析失败的测试
└── pyproject.toml
```

分层规则：api 层不碰 sim 内部；sim 层不 import narrate；persistence 负责事务与事实恢复，core 只承载完整状态和锁。领域写路径为 `api → locks → sim → repository → sse（提交后）`；AI 位于提交后的旁路，不能回写 sim 数值。`llm.py` 是 narrate 与具体模型之间的唯一缝隙，换模型只动它。实际文件名可调整，但不能恢复旧 sessions 路由或倒计时 timer。

## 3. 存档生命周期与写事务

| 环节 | 行为 |
|---|---|
| 创建 | `POST /api/saves`：默认 parcel_loader 加载 `beijing_cbd`，`sandbox` 才用 seed 调 sim.generator；生成唯一 8 位 Crockford Base32 city_code，并在一个事务中写入 saves 与初始完整状态，返回 phase=briefing、city_year=1、last_seq=0 的 SaveState |
| 开始 | `POST …/start`：仅持久化 briefing→building，重复调用返回当前状态；`phase_change` 在提交后广播 |
| 领域写 | place/remove/redevelop/advance 在 per-save 锁内先查 client_op_id，再校验、sim 重算、分配 seq；op（规范 payload + 首次 result_json）、SaveState 与每 50 op 可选快照同事务提交，提交后才广播 |
| 只读推演 | `POST …/project` 读取一致的 `base_year/base_seq` 快照，在副本上运行共享年度步进；不写 ops/saves/snapshots/reports，不推进实际年份或资金 |
| 当前报告 | `POST …/report` 在当前快照计算 scores/ending，写 reports 历史但不写领域 op、不增加 last_seq；可先返回模板，AI 后续以相同 report_id 更新并广播。GET reports 只读，新到旧最多 20 份 |
| 恢复 | 进程重启或缓存未命中时，从 SQLite 读最近快照 + 重放增量 ops；恢复快照范围必须满足 02 §6，不得只恢复 tiles/metrics/year/phase |
| 保留 | 存档永不过期，不提供 TTL 清理、离线编辑或旧式重开；城市管理者另起城市 = 创建新 save |
| 并发 | 每个 save 一把 asyncio.Lock 串行化领域写操作；`base_seq` 落后不拒绝，占用/资金等业务规则仍按 02 返回错误。SSE 订阅不加写锁 |

AI 简报或叙事可以异步生成，但不得拖延领域事务；AI 事件、report 和 project 均不增加领域 op seq。

## 4. SSE 实现要点（对齐 02 §4）

- 每存档一个以 city_code 为键的 broadcaster：事件进入 200 条环形缓冲后推给活跃订阅；缓冲只是断线优化，SQLite 才是城市事实源。
- 领域事件有独立的单调整数 SSE `id`，与 op seq 是两套序号。`op_applied` 携带完整 OperationResult；advance 另发同 seq/client_op_id 的 `city_year`，客户端按 02 幂等处理。
- 心跳每 15s 发送 SSE comment `: heartbeat`，不发送 tick，也不用心跳推进年份或校正倒计时。
- 新连接先订阅再决定补发/快照，处理 cutoff 前去重。Last-Event-ID 在缓冲内则补发；无缓冲、溢出或进程重启无法确认时发送完整 `snapshot`。
- phase_change/news/citizen/mentor/projection_step/report_ready/error 全部走同一 broadcaster。projection_step 只播放 project 已计算的切片并携带 projection_id/base_year/base_seq；它不写回，也不强制切换他端 UI。
- snapshot 总是完整 SaveState。客户端 seq 跳号时直接 GET 存档全量恢复，后端不伪造缺失 op。

## 5. AI 编排层（narrate）

- **入口**：领域 op 与状态**提交并广播后**，MetricsDiff → router 按 [04](04-ai-roles.md) §2-4 的触发规则与节流判定是否需要调用角色；需要则把任务丢进 asyncio 队列（每存档深度 ≤3，超出丢弃该次 AI 尝试并使用模板兜底）。导师计数只累计已提交 place/remove/redevelop/advance，每 10 op 一次；主动 mentor 走 202 + SSE。
- **调用**：roles 组装系统提示词 + 上下文（指标快照 + diff + base_year/base_seq + 防复读样本 + 注入防护声明），经 llm.py 发送；超时 news/citizen 8s、mentor/report 20s。
- **解析**：按 02 §4 各事件的 data 形状校验（Pydantic）；失败重试 1 次；再败走 templates.py 模板。
- **回推**：成功/模板文案都走同一个 broadcaster，前端无感知。
- **隔离**：llm.py 任何异常都不冒泡到 api 层；llm 整体不可用时 router 直接走模板分支，游戏功能零影响。

## 6. 幂等与一致性

- place/remove/redevelop/advance 都在 per-save 锁与 SQLite 事务内执行。`(save_id, client_op_id)` 有唯一约束；重复请求直接返回首次持久化的完整 `result_json`，不重复扣款、落格、分配 seq 或广播。
- `client_op_id` 为 1–128 字符且在存档内唯一；`base_seq` 只用于客户端回显/诊断，落后不导致拒绝。不能再用 cell_occupied 代替请求幂等，因为它会把网络重试错误地变成业务冲突。
- op 的 seq 在事务内分配，op、状态更新与可能的 50-op 快照一起提交；只有提交成功才广播。AI 调用失败、超时或解析失败不影响首次操作结果。
- project 是只读纯计算，可重复请求并产生新的只读预览；report 可反复生成并各写一条报告历史，但二者都不是领域 op，不需要一次性结算标志，也不锁定城市。
- 恢复以最近快照 + 增量 ops 重放为准；完整 SimConfig、parcel/data_version、实际入住、环境状态与 redevelop 惩罚等 02 §6 状态必须纳入快照，不能依赖进程内隐含值。

## 7. 观测与日志

- 结构化日志（JSON 行）：每次操作记 save_id / city_code / op_type / seq / client_op_id / 耗时 / 结果；project/report 与领域 op 分开计数，narrate 记角色 / 模型 / 时延 / 是否降级。不得记录 LLM 密钥。
- GET /healthz：返回进程存活 + 存档数 + SQLite 可用性/WAL 状态 + 配置摘要（脱敏），供部署脚本探活；备份与恢复说明链接到 10 和本文件。
- SQLite 使用 WAL 与参数化写入，运行只启动一个 uvicorn worker。在线备份必须使用 SQLite backup API 或等价安全机制，恢复后打开数据库并核对存档/ops/snapshots/reports；不得在写入期间只复制主 db 文件充当一致备份。

## 8. 后端验收标准（DoD，逐条打勾）

1. 02 saves v2 全部端点与事件类型按样例测试全绿；错误协议 7 个 code 逐一命中过，旧 sessions/finalize/restart/tick 不出现在应用路由或事件表。
2. 相同存档 seed、parcel 数据版本、完整 SimConfig 与领域 op 序列，两次运行 SaveState 和相同输入的 ProjectionResult 逐字段一致。
3. 随机 200 个混合领域 op 落库后，杀掉进程并重放，与在线状态逐字段一致；>50 op 时最近快照 + 增量重放 == 全量重放。
4. project 在 48×48 满布局最坏情况下满足 03 §9 性能目标，且对 ops/saves/snapshots/reports 零写入；report 不增加 last_seq，城市可继续经营。
5. 全量重算 <10ms（抽样 100 次取 p95）；advance 与 project 共用年度步进，区别只有是否写回。
6. 相同 `(save_id, client_op_id)` 重试返回首次完整结果且不产生第二次效果；base_seq 落后不拒绝，并发写按存档串行。
7. 关闭所有 LLM 环境变量后：创建→start→建设→advance×3→project→report→继续经营全流程可玩，事件流和报告有模板叙事。
8. SSE 断连 30 秒内重连可补发；缓冲溢出（断 200 条以上）或重启无法确认时发 snapshot；双端 seq 跳号走全量恢复，自端广播不重复。
9. sim-config.yaml 每个参数改值后，行为变化符合 03 文档语义（参数化抽查 5 项）；不含现实阶段时长配置。
10. /healthz 可访问且不泄露密钥，能报告 SQLite 状态；在线备份文件可打开，恢复后内容一致。

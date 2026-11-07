# 10 · 不限时经营 · 持久化存档 · 多端同步（v2 变更专题）

> 本文档覆盖此前规划的三处根本决策：**取消一切现实时间限制**、**城市即长期存档（SQLite 持久化）**、**多端实时同步同一存档**。玩家身份统一称为「**城市管理者**」（不再用「市长」）。
> 本文说明设计决策；接口字段、端点与事件以 [02](02-data-contract.md) saves v2 为唯一契约。旧文档仅作背景，变更对照见 §1。PR-23~26 正式任务卡见 [08](08-pr-tasks.md)，里程碑 M7。

## 1. 变更对照表（旧文档 → 本文）

| 旧内容 | 位置 | 变更为 |
|---|---|---|
| 单局硬上限 20 分钟、5 阶段倒计时状态机 | 00 定义 / 01 §5 / 05 §2.4 | 不限时自由经营，4 态玩家主动流转（§3） |
| 会话存内存、无数据库 | 00 OUT / 06 | SQLite 持久化 + 事件溯源（§4）；「用户账号」仍为 OUT |
| REST 8 端点（sessions）、tick 倒计时事件 | 02 | API v2：saves 体系 8 端点 + SSE 事件调整（§5），**契约升 v2** |
| 推演 10 年 = 终局一次性 | 01 / 03 §6 | 推演 = 可反复的**只读预览**，不写回存档；年度前进用 advance（§3） |
| 结局 = 终局判定 | 01 §6 | 结局 = 报告时点的「城市体检标签」，判定规则不变、语义非终局 |
| 导师 90s 定时点评 | 04 §4 | 每 10 次操作或玩家主动「请教导师」（§6） |
| 市长 | README / 各文档 | 统一术语「城市管理者」 |

## 2. 玩家体验闭环（新）

创建/加入城市 → 自由建设（不限时）→ 随时「快进一年」看城市运转 → 随时「未来推演」预览 10 年 → 随时「城市诊断」出报告 → 继续经营。换设备：输入 8 位城市码，接着玩。同一存档可在手机 + 电脑同时打开，操作实时互见。

## 3. 时间与阶段模型

**城市时间**（`city_year`，整数，开局第 1 年）取代现实倒计时：
- `advance`：快进一年——执行年度结算（[03 §5](03-sim-engine.md) 财政/人口迁移/逃离潮/事件池），**写回存档**，广播 `city_year`。
- `project`：以当前状态为基底复制推演 N 年（默认 10）——**只读预览不写回**，返回年度切片供 ProjectionPlayer 播放；播放期间允许继续建设（预览标注「基于第 N 年快照」）。
- `report`：任意时点生成诊断报告（五维评分 + 体检标签 + report_text），可反复，历史留存最近 20 份。

**持久化阶段 2 态 + 本地 UI 2 态**（不再有任何倒计时）：

| 状态 | 是否写入 Save.phase | 含义 | 出口 |
|---|---|---|---|
| briefing | 是 | 查看地块与目标 | 点「开始规划」→ building |
| building | 是 | 自由经营（place/remove/redevelop/advance/project/report/mentor） | 常驻态 |
| projecting | 否，各端独立 | 基于某 base_seq 的只读预览播放；他端可继续建设 | 播放结束/取消 → 本地 building 视图 |
| report | 否，各端独立 | 当前报告展示与历史回看；他端可继续建设 | 关闭 → 本地 building 视图 |

这样避免一台设备看报告时阻塞另一台设备，也避免把可随时取消的 UI 状态写入共享存档。删除 build 15min / polish 2min / locked 40s 全部时限；前端倒计时组件改为常驻「第 N 年」徽章。

## 4. 持久化与事件溯源（PR-23）

**选型：SQLite（WAL 模式，单文件 `data/city20.db`）+ aiosqlite。** 零运维、单文件即备份、FastAPI 友好；不引外部数据库服务。

| 表 | 关键字段 | 说明 |
|---|---|---|
| saves | save_id、city_code、name、seed、city_year、phase、last_seq、parcel_id、data_version、sim_config_json、created_at、updated_at | 城市元信息、规则与数据版本 |
| ops | save_id、seq（存档内单调递增）、op_type（place/remove/redevelop/advance）、payload、result_json、client_op_id、created_at | 操作日志与幂等首次响应 |
| snapshots | save_id、seq、state_json | 每 50 个 op 打一次完整状态快照 |
| reports | save_id、report_id、created_at、payload_json | 报告历史，保留最近 20 份 |

完整快照范围见 [02 §6](02-data-contract.md#6-持久化最小状态)，包括实际入住、环境/森林状态、redevelop 惩罚、规则和数据版本；不能只存 tiles/metrics/year/phase。

- **载入 = 最近快照 + 重放增量 ops**。确定性 sim（[03](03-sim-engine.md)）保证重放结果与在线逐次计算逐字段一致——这是 PR-23 的核心验收。
- **city_code**：8 位 Crockford Base32（去除易混淆字符），唯一索引。知道城市码即可共同经营——**分享即协作是特性**；后端对 REST 做简单速率限制防枚举。
- **幂等**：`client_op_id` 唯一约束（save_id+client_op_id），重复提交返回首次结果（移动端重试安全）。
- 原「会话 40 分钟过期」删除；存档永不过期。内存仍可做热点缓存，但**数据库是唯一事实源**，重启不丢城。

## 5. API v2（替换 02 的 REST 与 SSE 表）

REST 完整请求/响应、7 错误码及字段见 [02 §1/§3](02-data-contract.md)。端点包括：create/get/start、place/remove/redevelop/advance、project、report/reports、mentor、events。写操作统一使用 `type/anchor` 或 `tile_id/anchor` 加 `client_op_id/base_seq`，不再混用 `block/anchor_r/anchor_c`。

原 `restart` 删除（重开 = 新建存档）；原 `finalize` 由只读 `project` + 可随时 `report` 取代。SSE 完整事件形状见 [02 §4](02-data-contract.md)：新增 `snapshot/op_applied/city_year`，保留 phase/news/citizen/mentor/projection/report/error，删除 tick；op seq 与 SSE id 分离。

## 6. 多端同步协议（PR-24）

后端为唯一权威，写操作按存档串行（per-save asyncio.Lock，沿用 06 设计）：

1. 任意端发 REST 写操作 → 后端校验（占用冲突 409、资金不足 402 等不变）→ 落 ops 表 → sim 重算 → 广播 `op_applied`（含 seq 与 metrics_diff）。
2. 各端收到 `op_applied`：seq 与本地连续 → 本地应用 diff；**seq 跳号 → 直接 GET 全量恢复**（兜底策略，杜绝状态漂移）。
3. `base_seq` 仅用于客户端回显去重，后端不因 base_seq 落后拒绝操作（格子冲突已由 409 覆盖）。
4. 发起操作的本端收到自己 op 的广播时按 client_op_id 去重（REST 响应已先行更新）。
5. 断线：沿用 2s 重连 + Last-Event-ID；缓冲溢出/seq 不连续 → 全量恢复。
6. 离线编辑不做（OUT）；在线即同步。

**AI 触发调整**（[04](04-ai-roles.md) 修订）：数据大脑 8s 节流照旧；市民按敏感度路由照旧；导师点评改为「每 10 次写操作自动一次 + 玩家可随时点『请教导师』」，90s 定时器删除；报告由 report 端点随时生成，三段式与理论引用不变。

## 7. 前端变更（PR-25）

- **首页**：两个入口「创建新城」（可选命名/种子）与「输入城市码加入」；本机最近城市列表存 localStorage（仅存 city_code 与名字，不是事实源）。
- **游戏页**：倒计时 → 「第 N 年」徽章 +「快进一年」「未来推演」「城市诊断」「请教导师」四个主动按钮；城市码常驻显示 + 一键复制（分享即协作）。
- **同步呈现**：他端操作落格带 300ms 高亮脉冲 + 信息流系统条（「另一台设备放置了小学」）；seq 跳号自动全量恢复并 toast 提示。
- **报告页**：可反复生成、历史列表回看；结局徽章文案改「城市体检标签」。
- **四端**（[09](09-cross-platform.md)）：同一后端地址 + 同一城市码即跨端续玩——**存档同步是四端的核心价值**，M7 验收必含「Android 与桌面端同存档互见操作」。
- 全部玩家可见文案中「市长」改「城市管理者」。

## 8. 测试与验收追加（[07](07-qa-ops.md) 增补）

- 重放一致性：随机 200 ops 落库 → 杀掉进程 → 载入重放 → 与在线状态逐字段一致（黄金样例）。
- 快照正确性：>50 ops 后快照+增量重放 == 全量重放。
- 幂等：同 client_op_id 重复提交不产生第二格。
- 双端同步：两个客户端交替/同时操作 50 次，最终两端状态一致；seq 跳号注入测试走全量恢复。
- 持久化：后端重启后城市码可恢复全部现场。
- 比赛日 checklist 修订：「完整 20 分钟一局」改为「建城 → 建设 → advance ×3 → project → report → 换端续玩」全流程；新增「SQLite 文件备份」一项。

## 9. 对既有 PR 的影响

| 已合并/旧卡 | 处理 |
|---|---|
| PR-01/02/06/07/08（已合并） | sim 数值与契约模型不变；`Session` 概念由 PR-23 包成 Save 持久化，路由从 sessions 迁到 saves |
| PR-03（已合并） | 桩端点由 PR-23 按 v2 表迁移；错误协议不变 |
| PR-09~12（AI 线） | 仅触发器调整（§6），prompt/模板/降级不变 |
| PR-13（SSE 网关） | 广播键 session→city_code，事件表按 §5 增删 |
| PR-15（状态机前端） | 按 §3 四态实现，倒计时组件不做 |
| PR-16（推演与报告页） | ProjectionPlayer 复用；报告页加历史与「继续经营」出口 |
| PR-19~22（四端） | 不变，验收追加跨端同存档用例 |

砍单顺序更新：M6 四端（按 09 §8）→ PR-17 打磨 → 报告历史 → 环境事件池；**存档与同步不可砍**（本项目立项目标）。

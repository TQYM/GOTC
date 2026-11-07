# 07 · 测试与交付保障

> 48 小时项目的 QA 策略：**用最少测试保护最要命的不变量**。不追覆盖率，追"坏了能立刻发现"。
> ⚠️ 不限时改造（m00594）：主流程为建局→建设→快进/推演→报告（无倒计时、无锁定），存档持久化与多端同步验收见 [10](10-persistence-sync.md)；真实片区与 redevelop 验收见 [11](11-real-beijing-3d.md)。

## 1. 测试金字塔（按优先级）

| 层 | 内容 | 保护的命脉 | 归属 |
|---|---|---|---|
| L1 sim 黄金样例 | 固定 parcel 数据版本/沙盒 seed + 固定领域 op 序列 → 指标逐字段断言（人口/地价/通勤/幸福度各 2 例，含边界：满布局、只放住宅、redevelop） | **确定性**（03 §1）：改动公式时立刻知道谁变了 | 后端 |
| L2 契约样例测试 | 按 [02](02-data-contract.md) 每个 saves v2 端点的请求/响应 JSON 样例逐一过；7 个错误码各命中一次；§4 全部 SSE 事件各推一条 | **前后端不打架**：接口漂移秒发现 | 后端（前端按 mock 联调时天然复验） |
| L3 推演性能测试 | 满布局（200 区块）project 满足 03 §9；重算 p95 <10ms；断言 project 对四类表零写入 | **契约性能与只读性**（02 §2.6/§3） | 后端 |
| L4 降级链路测试 | 关掉 LLM 环境变量走通创建→建设→advance→project→report→继续经营：模板文案出现、游戏不崩、报告有叙事 | **AI 挂了游戏照跑**（铁律） | 后端 |
| L5 前端关键路径 | 创建/加入→start→放 3 块/redevelop→advance×3→project→报告出雷达图→关闭报告继续经营→历史回看（Playwright，可用 mock 后端） | 主流程不被 UI 重构弄断；projecting/report 不写入共享 phase | 前端 |
| L6 人工手感测试 | 10 次连续拖拽放置零误触；断网 10s 恢复一致；他端操作有脉冲/系统条 | 手感、断线与多端同步呈现 | 前端 |
| L7 事件溯源与备份 | 随机 200 ops 重放逐字段一致；>50 op 快照+增量==全量重放；重复 client_op_id 返回首次结果；进程/仓储重建后城市码恢复；在线备份可打开且一致 | **SQLite 唯一事实源与重启不丢城**（02 §6、10 §4） | 后端 |
| L8 双端并发同步 | 两客户端交替/并发共 50 写操作最终一致；自端 client_op_id 去重；Last-Event-ID 补发、溢出 snapshot、seq 跳号 GET 恢复；一端报告/推演不阻塞另一端 | **多端不漂移、不重复落格**（02 §4、10 §6） | 前后端 |

## 2. CI（已配置，本次规划提交时升级 actions v5）

- `.github/workflows/ci.yml` 检测式：frontend/ 有 package.json 才跑 lint+build，backend/ 有 pyproject.toml 才跑 ruff+pytest——**骨架未落地前全绿，永不误报**。
- CI 还会始终执行 Markdown 相对链接检查；链接目标不存在时直接失败，避免规划文档引用漂移。
- actions 版本已核查升级：actions/checkout v4→v5、actions/setup-node v4→v5（setup-python 已是 v5）。
- 分支纪律照 [CONTRIBUTING.md](../../CONTRIBUTING.md)：feat/xxx 当天合当天删；免审直通不等于免 CI。

## 3. 本地运行与部署

| 场景 | 启动方式 |
|---|---|
| 日常开发 | 后端**单 uvicorn worker**（8000）+ 前端 `npm run dev`（3000），前端用 `NEXT_PUBLIC_API_BASE=http://localhost:8000`；默认 SQLite `data/city20.db` |
| 比赛演示 | 后端单进程起服务 + 前端 build 后同一域反代（一条启动脚本写进 scripts/，PR-18 交付物）；演示前完成 SQLite 在线安全备份 |
| 离线兜底 | LLM 全关（不配 key）→ 模板文案版，功能零损失；真实北京数据包本地加载，不请求在线地理服务 |
| 存档恢复 | 重启后按城市码恢复：最近快照 + 增量 ops；备份使用 SQLite backup API/等价安全机制，恢复后校验 saves/ops/snapshots/reports |

## 4. 比赛日 checklist（PR-18 交付物之一，逐项打勾）

1. 无 key 冷启动：单 worker 起服务 → 创建真实北京存档 → start → 建设/redevelop → advance×3 → project（确认零写入）→ report → 关闭报告继续经营；随后重启后端，按城市码完整恢复，并验证一次 SQLite 在线备份可打开、内容一致。
2. 联网版一遍：配 key → 三角色说话 → 每 10 领域 op 或主动请教导师 → report_ready 以相同 report_id 替换模板叙事，分数和城市体检标签不变。
3. 数据复现演示：默认片区核对 `parcel_id/data_version` 与真实地图；`parcel_id="sandbox", seed=882314` 两次开局地块完全一致。
4. 断线与双端演示：拔掉网络 30 秒 → 重连 → 补发或 snapshot 恢复；手机/另一浏览器用同一城市码加入并互见操作，注入 seq 跳号后 GET 全量恢复；一端看报告时另一端继续建设。
5. 平衡记录：五种策略（全住宅 / 工业优先 / 绿地狂魔 / 地铁狂魔 / 混合）× 5 个 seed 的当前报告评分与指标截图，按 12 的记录口径附在 README。**样本尚未完成时保持未勾选，不宣称 PR-18 完成。**
6. demo 视频 90 秒：创建/加入真实北京 → 建设/redevelop → 信息流吐槽/主动请教 → advance → 只读推演 → 当前城市体检报告 → 继续经营与换端续玩。

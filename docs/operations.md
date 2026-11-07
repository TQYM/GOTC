# CITY20 运行与存档运维

## 单进程启动

saves v2 的热状态、SSE 扇出和 op 序号由单个进程协调，**只能启动一个 uvicorn worker**，不要使用 `--workers 2` 或多副本共享一个 SQLite 文件。

```bash
cd backend
pip install -e ".[dev]"
# 不设置 CITY20_LLM_API_KEY 即为无 key 模式，三角色自动使用模板。
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另一个终端：

```bash
cd frontend
npm ci
# NEXT_PUBLIC_API_BASE 默认 http://localhost:8000，也可写入 frontend/.env.local。
npm run dev
```

生产前端使用 `npm run build && npm run start`，不要在构建后才修改 `NEXT_PUBLIC_*` 并期望 bundle 自动改变。反向代理 SSE 端点 `/api/saves/*/events` 时关闭响应缓冲，保留 15 秒 comment 心跳。真实 GIS 与静态 JSON 均由本地后端提供，运行时不依赖在线地图服务。

## 无 key 演示检查

- [ ] 冷启动后 `/healthz` 正常，创建默认 `beijing_cbd`，`start` 后可建设、更新既有资产、推进年度。
- [ ] `project` 可播放但不改变真实年份/seq；`report` 可重复生成、回看和关闭，随后继续经营。
- [ ] 三角色显示模板来源；缺 key、超时或限流不阻塞领域操作。
- [ ] 两个浏览器通过同一 8 位城市码加入，落格、拆除、更新和年度保持一致。
- [ ] 重启后端后用城市码恢复完整城市；断网重连通过 Last-Event-ID 或全量快照恢复。
- [ ] 真机检查拖拽/点击误触、手机布局与 WebGL 帧率，并记录设备，不能以单元测试替代。

## 在线备份

备份使用 Python 标准库的 SQLite backup API，不要在服务运行时直接复制 `.db`、`.db-wal` 和 `.db-shm` 三个文件来拼装备份。

```bash
# 从仓库根目录执行；默认读取 CITY20_DATABASE_PATH 或 data/city20.db。
python3 scripts/backup_db.py --output backups/city20-demo.db
```

脚本以只读事务读取源库，拒绝覆盖现有文件，并检查目标 `PRAGMA integrity_check` 以及 saves/ops/snapshots/reports 行数。输出包含备份路径、行数和字节数。`backups/` 与运行时数据库均被 git 忽略。

## 恢复

1. 停止唯一后端 worker，避免恢复期间继续写入。
2. 将当前数据库先做一次在线备份或移到自己的备份目录，不覆盖唯一副本。
3. 对恢复文件执行 `sqlite3 /path/to/backup.db 'PRAGMA integrity_check;'`，必须返回 `ok`。
4. 将恢复文件放到 `CITY20_DATABASE_PATH` 指定位置；删除该目标旁由旧运行留下的 `-wal`/`-shm` 前，确认后端已停止且旧 WAL 已另外备份。
5. 启动同一个单 worker，使用城市码调用 `GET /api/saves/{city_code}`，检查年份、seq、tiles、redeveloped_asset_ids 和报告历史，再恢复对外服务。

城市码只是便捷协作凭证，不是账号或高强度鉴权；不要把包含隐私城市名的服务直接暴露到不受信网络。

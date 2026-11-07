# 协作规范

48 小时极限开发，规范从简，但以下几条必须遵守——它们是为了让三个人并行写代码时不互相踩脚。

## 分支模型

- `main`：唯一长期分支，**始终保持可运行**。比赛期间不 force push、不 rebase 已推送历史。
- 功能开发：从 `main` 切短分支，`feat/xxx`、`fix/xxx`、`chore/xxx` 前缀，**当天合并当天删**。
- 48 小时赛程内，单人小步提交允许在豁免名单下直接推 `main`（见下文），但**跨两人以上的改动必须走 PR**。

## Commit 规范（Conventional Commits）

```
<type>(<scope>): <一句话说清做了什么>

type: feat | fix | docs | style | refactor | perf | test | chore | ci
scope: frontend | backend | docs | ai | sim | scripts（可省略）
```

示例：

```
feat(sim): 加入路网饱和度计算
fix(frontend): 拖拽放置时地块高亮偏移
docs: 更新 AI 三脑 prompt 设计
```

- 一句话概括，不超过 50 字；需要解释动机就空一行写正文。
- 一个 commit 只做一件事，别把格式化与功能改动混在一起。

## PR 流程

1. 分支推上去 → 开 PR → CI 绿 → 找人审查 → squash merge。
2. PR 标题同样遵守 Conventional Commits。
3. PR 描述按模板填，**「测试了什么」一栏不许写「没测」**——没时间测就写清楚风险点。

## 免审直通（仓库规则集已配置）

| 成员 | 权限 |
|---|---|
| @IGNGserver | push `main` / PR 免审合并 |
| @huihiya | push `main` / PR 免审合并 |
| @TQYM（仓库管理员） | 同上 + 规则集管理 |

其余协作者（含后续加入者）提 PR 需 1 人审查。

> 直通权限意味着**你自己为你的代码负责**：推上去的东西必须能跑，或至少不破坏别人能跑的部分。

## 代码风格

- 前端：TypeScript strict，Prettier 默认配置（脚手架落地后由 CI 强制执行）。
- 后端：Python 3.11+，Ruff（lint + format），类型注解覆盖公开函数。
- 编辑器统一 [.editorconfig](.editorconfig)：2 空格缩进（Python 4 空格）、LF、UTF-8。

## 环境问题

- 任何密钥/Token 只进 `.env`（已被 gitignore），仓库里只保留 `.env.example`。
- 发现 `.env` 被误提交，立刻在群里喊一声并轮换密钥，不要默默改掉完事。

# 来源声明与项目局限

> 本文档声明 CITY20 项目使用的模型、数据、图片与第三方代码来源，并如实说明项目局限。

## 1. 模型

**运行时（游戏内 AI 叙述层）**

- 后端通过自研的 OpenAI 兼容抽象层（`backend/app/narrate/`）调用大语言模型，路由**国产模型**：DeepSeek、Qwen、Kimi、GLM（按角色与可用性自选，密钥经环境变量注入，不入库）。
- 架构铁律：**AI 只做叙述层，绝不参与数值计算**。全部 14 项城市指标由确定性模拟引擎（`backend/app/sim/`）重算，seed 可复现；LLM 仅将数值翻译为新闻（数据大脑）、市民之声（5 人设微博体）、导师点评（引用 GB 50180-2018 生活圈标准）三类文本。LLM 全部不可用时自动降级为内置模板文本，游戏完整可玩。

**开发期（编程辅助）**

- 项目规划、后端与数据管线代码：DeepSeek 系列模型辅助编写，人工审阅合入。
- 前端 3D 场景与游戏页：Claude Opus 5.5 辅助编写，人工审阅合入。
- 所有合入代码均通过 CI（ruff / eslint / pytest / next build）与人工 review。

## 2. 数据

**真实数据（OpenStreetMap）**

- 地理骨架来自 [OpenStreetMap](https://www.openstreetmap.org/)，© OpenStreetMap contributors，许可 **ODbL 1.0**。声明见 `data/parcels/*/LICENSE.txt`。
- 使用范围：全域 154×189 km 内的道路（主干/次干 34,517 条）、水系（10,937 段）、绿地（4,532 处）、地名（13,706 条，含地铁站/学校/医院/村庄）、具名建筑（12,388 栋）与地标真实轮廓（中国尊、央视总部、故宫、鸟巢、水立方）。
- 抓取工具：`tools/prepare-beijing/fetch.py`（Overpass API 分批拉取，尊重限速）。

**程序生成数据**

- 普通建筑（58,644 栋）由**扩散凝聚 + fBm 噪声**算法在真实骨架之上生成：urbanity 连续场（城市核心 + 真实城镇点距离衰减 + 噪声扰动）驱动城乡渐变分布；乡村聚落锚定真实村庄坐标。
- 地形高程为**程序合成**（西山/燕山地理掩膜 + 分形噪声，250–1550m），非真实 DEM；平原区高程近似。
- 全部生成过程**确定性可复现**：`seed = 20261107`，管线一键重跑（`tools/prepare-beijing/prepare_beijing.py`）。

## 3. 图片

- 项目**未使用任何外部图片、贴图或素材库**。3D 场景全部程序化渲染：卡通材质的 3 阶渐变贴图为代码生成的 DataTexture，建筑/地形/植被均为几何体实时生成。
- 仓库内 README 插图与预览页（`tools/preview/`）均由本项目代码渲染产出。

## 4. 第三方代码

| 范围 | 依赖 | 许可证 |
|---|---|---|
| backend | fastapi、httpx、pydantic、pydantic-settings、pyyaml、sse-starlette | MIT / BSD-3 |
| backend dev | pytest、ruff | MIT |
| frontend | next、react、react-dom、three、@react-three/fiber、@react-three/drei、zustand、@dnd-kit/core | MIT |
| frontend dev | typescript、tailwindcss v4、eslint、eslint-config-next、eslint-config-prettier、prettier | Apache-2.0 / MIT |
| 预览工具 | three.js 0.169（`tools/preview/vendor/` 本地化，MIT） | MIT |
| CI | actions/checkout@v5、actions/setup-node@v5、actions/setup-python@v5（GitHub 官方） | MIT |

- 未抄改任何开源代码块；国标《城市居住区规划设计标准》GB 50180-2018 仅作为游戏设计参照（数值为简化对标，非官方数据）。

## 5. 项目局限

1. **模拟深度**：指标模型为教学级简化——BPR 单层路阻交通、静态权重指标，非微观交通/agent 仿真；数值未经真实城市数据标定，为合理假设下的推演。
2. **地形与建筑保真度**：高程为程序合成（非 DEM）；除五大地标保留真实轮廓外，其余建筑为生成体块，不与真实外观一致（功能性建筑保留真实名称与位置并标注）。
3. **覆盖范围**：真实道路骨架集中于城四区（东城、西城、朝阳、海淀核心区），远郊路网与建筑为生成内容。
4. **交付状态**：48 小时工期内核焦点在模拟引擎、AI 叙述与 3D 渲染；前后端联调与移动端/桌面端壳（Capacitor / Tauri）按规划（docs/plan/09）尚未交付，当前以 Web 端为主。
5. **AI 叙述依赖外部 API**：LLM 不可用时降级为模板文本，叙事丰富度下降但玩法完整。

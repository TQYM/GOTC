# 09 · 四端适配（macOS / Windows / Android / iOS）

> 在 Web 版（[05](05-frontend.md)）之上扩展四端，**不重写任何原生界面**：一套 Next.js 前端代码，套两层壳——Capacitor 出移动端、Tauri 出桌面端。后端（[06](06-backend.md)）零改动，四端连同一套 API。
> 新增 PR-19~22（见 [08](08-pr-tasks.md)），里程碑 M6。优先级见 §8：演示价值排序，时间不够从后往前砍。
> ⚠️ **渲染升级为 Three.js 真 3D**（见 [11](11-real-beijing-3d.md)）：四端验收补 WebGL2 支持与帧率（桌面 ≥55fps / Android ≥30fps，移动端像素比上限 1.5、关阴影）；§5 触屏手势映射到 3D 相机（单指旋转、双指缩放平移、点选放置经 Raycaster）。

## 1. 战略：一套代码四端跑

| 端 | 壳 | 复用度 | 不做的事 |
|---|---|---|---|
| macOS | Tauri 2（系统 WebView） | 前端代码 100% 复用 | 不写 Swift/AppKit 界面 |
| Windows | Tauri 2（WebView2） | 同上 | 不写 WinUI/WPF |
| Android | Capacitor（Android System WebView） | 同上 | 不写 Kotlin/Compose 界面 |
| iOS | Capacitor（WKWebView） | 同上 | 不写 SwiftUI 界面 |

Canvas 沙盘、SSE 信息流、报告页在四种 WebView 里都是标准 Web API，无需分支实现。

## 2. 技术选型（2026-11 联网核查）

| 选型 | 版本要求 | 理由 | 放弃的备选 |
|---|---|---|---|
| Capacitor | 稳定线（≥7；9 仍为 beta，不追） | 移动端 Web 壳事实标准；插件生态全；Android/iOS 共用一套配置 | React Native 重写（人力×2，否决）；PWA 安装（iOS 推送/后台受限，且不算"App"交付） |
| Tauri | ≥2（当前 2.12） | 包体 ~10MB 级；系统 WebView 免内置 Chromium；Rust 壳构建快 | Electron（包体 ~200MB，启动慢，演示电脑性能不可控） |

运行时依赖声明（写进各端构建文档，装错版本是新人第一坑）：
- Tauri：Rust stable 工具链 + 系统 WebView（macOS 自带；Windows 10/11 自带 WebView2，缺则引导安装）。
- Capacitor Android：JDK 17+、Android SDK（API 24+ 为 minSdk 目标）。
- Capacitor iOS：仅 macOS 可构建，Xcode 15+。

## 3. 统一架构

```
┌──────────── 同一套前端产物（静态导出 dist/）────────────┐
│  Canvas 沙盘 / 工具栏 / 信息流 / 报告页                    │
│  API 客户端：baseURL 运行时读取（见 §4.3）                 │
└───────┬───────────────┬───────────────┬─────────────────┘
   Tauri 壳          Tauri 壳        Capacitor 壳（×2）
   macOS .app        Windows .exe     Android APK / iOS .ipa
        └───────────────┴───────────────┴───→ 同一个 FastAPI 后端
                                        （局域网 / 本机 / 部署地址，可配置）
```

**后端零改动**（仅 §4.3 的 CORS 白名单一处配置）；**游戏逻辑零改动**；所有适配工作集中在前端与打包层。

## 4. 必须的前端改造（PR-19，四端公共前置）

### 4.1 静态导出

Capacitor/Tauri 都要求前端是**纯静态产物**：Next.js 开 `output: 'export'` 构建。约束与对策：

| 约束 | 影响 | 对策 |
|---|---|---|
| 静态导出禁用 API 路由 | 本项目 API 全在 FastAPI，Next 无 API 路由 | 无影响 |
| 动态路由 `/game/[sessionId]`、`/report/[sessionId]` 不能运行时解析 | 建局跳转失效 | 路由改造：`/game?session=xxx`、`/report?session=xxx`（query 参数）。Web 版同步改，四端共享同一路由形状；旧路径做重定向 |
| 服务端渲染/服务器组件不可用 | 首屏即客户端渲染 | 三个页面本就全是客户端交互，无影响 |

### 4.2 后端地址运行时配置

- 前端读取顺序：设置页手动输入 > 本地存储记住的上次地址 > 环境默认（Web 同源；壳端默认 `http://本机IP:8000` 占位）。
- 首次启动若连不上后端：弹出「后端地址」设置页（输入框 + 连通性测试按钮 + 保存），而不是白屏——**这是壳端唯一的原生感差异点**。
- CORS：后端白名单允许壳端来源（Capacitor 为 `capacitor://localhost`、`http://localhost`；Tauri 为 `tauri://localhost`、`http://tauri.localhost`），通过环境变量配置，不硬编码。

### 4.3 SSE 在壳内的兼容

四种 WebView 均支持 EventSource。注意项：
- iOS WKWebView 后台挂起时 SSE 断开 → 回到前台走既有断线恢复（[05 §3.3](05-frontend.md)），无需新代码。
- Android 部分 ROM 省电策略杀后台 → 同上，前台恢复时全量拉会话。
- 心跳 15s（02 契约）兼作壳端保活探针，UI 连接状态点保持显示。

## 5. 触屏交互适配（PR-19 同卡，移动端核心工作量）

桌面端的「拖拽放置」在触屏上不可用（手指遮挡 + 无悬停态），移动端改为**点选放置**：

| 交互 | 桌面端 | 移动端 |
|---|---|---|
| 放置 | 拖拽卡牌到格子 | ① 点选工具栏区块 → ② 沙盘进入放置模式（覆盖格预览随手指移动/点选移动）→ ③ 点「确认」按钮落子；点空白处取消 |
| 拆除 | 拆除模式点选 | 长按已放置区块 → 底部弹确认条 |
| 浏览 | 鼠标悬停高亮 | 单指拖动平移；双指捏合缩放（0.5×–2.5×，Canvas 重绘不卡帧） |
| 布局 | 三栏固定 | 沙盘优先的纵向布局；指标面板、规划工具与信息流依次排列；「第 N 年」与城市码吸顶常驻 |

硬指标：手机完成建城→建设→advance→project→report→继续经营的核心路径，操作总时长不得比桌面端多 25%（人工对比测试记录进 PR）。

## 6. 各端打包与分发

### 6.1 macOS（PR-21）

- 产物：`.app` + `.dmg`（Tauri bundler）。
- 签名与公证：**演示用可跳过**（首次打开右键→打开绕过 Gatekeeper）；若需对外分发再配 Developer ID。
- 验收：干净 macOS 机器双击可玩完整一局（连局域网后端）。

### 6.2 Windows（PR-21）

- 产物：NSIS 安装包 `.exe`（Tauri bundler）。
- 依赖：WebView2（Win10/11 基本自带，安装包内嵌引导检查）。
- 验收：干净 Windows 机器安装后可玩完整一局。

### 6.3 Android（PR-20）

- 产物：debug APK（演示直装）+ release APK（可选签名）。
- 构建：本地 Android Studio 或 CI（GitHub Actions ubuntu-latest + Android SDK）。
- 验收：两台不同品牌真机（或模拟器 API 30/34）安装可玩完整一局；触屏放置/缩放/抽屉全部可用。

### 6.4 iOS（PR-22，条件性交付）

- 构建：macOS + Xcode + Capacitor，模拟器包无需账号；**真机安装需要 Apple Developer 账号（$99/年）或免费个人证书（7 天有效期、限 3 台设备）**。
- 分发路径（按现场条件三选一，PR 里写明走了哪条）：
  1. 有开发者账号 → Ad-hoc / TestFlight 内测；
  2. 无账号 → 免费个人签名真机直装（Xcode 登录 Apple ID 即可，7 天有效，演示够用）；
  3. 账号与 Mac 都不可用时 → iOS 交付 Safari 全屏 PWA（添加到主屏幕），其余三端不受影响。
- 验收：iPhone 真机（或模拟器）可玩完整一局；后台切走 30s 回来现场恢复。

## 7. CI/CD 矩阵

在现有检测式 CI（[07](07-qa-ops.md)）之外新增构建工作流（PR-20/21 落地时启用）：

| 产物 | runner | 触发 |
|---|---|---|
| Android APK | ubuntu-latest | 手动 / tag |
| Windows NSIS | windows-latest | 手动 / tag |
| macOS dmg | macos-latest | 手动 / tag |
| iOS | 不纳入 CI（证书管理成本高，本地 Xcode 出包） | — |

产物以 Actions artifacts 保存，README 补下载指引。

## 8. 优先级与里程碑

新增 **M6 四端**（D2 22:00 之后弹性窗口；若必须挤进 48h，按以下顺序保交付）：

| 优先级 | 交付 | 理由 |
|---|---|---|
| P0 | PR-19 触屏适配 + 静态导出 | 四端公共前置；Web 版同步受益 |
| P0 | PR-20 Android APK | 演示传播成本最低（发给评委直装） |
| P1 | PR-21 macOS + Windows 包 | 桌面评委机覆盖 |
| P2 | PR-22 iOS | 账号/设备门槛最高，三条降级路径兜底 |

砍单顺序：iOS 真机 → Windows → macOS →（Android 与触屏适配最后砍）。

## 9. 风险登记册（四端新增）

| 风险 | 预案 |
|---|---|
| 静态导出路由改造破坏 Web 版 | PR-19 验收含 Web 版回归（[07](07-qa-ops.md) L5 用例重跑） |
| iOS 无账号/无 Mac | §6.4 路径 3（PWA）兜底，不阻塞其他端 |
| 手机 WebView 性能不足 | 验收帧时 <16ms（手机标准放宽于桌面 8ms）；必要时 Canvas 降采样渲染 |
| 壳端连不上后端 | §4.2 设置页强制引导；演示前 checklist 增加「四端各打一局」 |
| 48h 装不下 M6 | 按 §8 优先级砍，Web 版交付不受影响 |

// CITY20 桌面壳：Electron 主进程
//
// 做三件事：
//   1. 起一个本地静态服务器服务 frontend/out
//   2. 拉起 Python 后端（uvicorn）
//   3. 开一个窗口指向本地静态服务器
//
// 为什么不用 file:// 直接加载 out/index.html：
//   Next.js 静态导出的相对路径 + fetch 在 file:// 下都不稳，走 http 最省事。

const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const WEB_PORT = 5173;
const API_PORT = 17800;

let backend = null;
let win = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
};

function root() {
  // 开发态：仓库根；打包态：resources/app 下
  const candidates = [
    path.join(__dirname, "..", "frontend", "out"),
    path.join(process.resourcesPath || "", "out"),
    path.join(__dirname, "out"),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, "index.html"))) return c;
  return candidates[0];
}

function serve() {
  const dir = root();
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    let file = path.join(dir, p);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const alt = path.join(dir, p, "index.html");
      file = fs.existsSync(alt) ? alt : path.join(dir, "404.html");
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(WEB_PORT, "127.0.0.1", () => resolve(server)));
}

function startBackend() {
  const py = process.platform === "win32" ? "python" : "python3";
  const backendDir = path.join(__dirname, "..", "backend");
  const args = ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(API_PORT), "--log-level", "warning"];
  backend = spawn(py, args, { cwd: backendDir, env: { ...process.env, ...(process.env.CITY20_DATABASE_PATH ? { CITY20_DATABASE_PATH: process.env.CITY20_DATABASE_PATH } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
  backend.stdout?.on("data", (b) => console.log("[backend]", b.toString().trim()));
  backend.stderr?.on("data", (b) => console.log("[backend:err]", b.toString().trim()));
  backend.on("exit", (code) => console.log("[backend] exit", code));
}

function waitForApi(timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port: API_PORT, path: "/api/health", timeout: 1000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve(true);
        else retry();
      });
      req.on("error", retry);
      req.on("timeout", () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) { resolve(false); return; }
      setTimeout(tick, 400);
    };
    tick();
  });
}

async function boot() {
  await serve();
  startBackend();
  const ok = await waitForApi();
  if (!ok) console.warn("[boot] 后端 30 秒内没起来，界面会显示离线降级");

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#8FC7E8",
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  const target = process.env.CITY20_URL || `http://127.0.0.1:${WEB_PORT}/`;
  win.loadURL(target);
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[win] did-fail-load", code, desc, url);
  });
  win.webContents.on("render-process-gone", (_e, d) => console.error("[win] gone", JSON.stringify(d)));
  win.webContents.on("console-message", (_e, level, msg) => console.log("[web]", msg));
  win.on("closed", () => { win = null; });
}

app.whenReady().then(boot);
app.on("window-all-closed", () => { if (backend) backend.kill(); app.quit(); });
app.on("before-quit", () => { if (backend) backend.kill(); });

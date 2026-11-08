# PPT 导出工具

从 `../index.html` 重新导出 `../CITY20.pptx`：

1. 起本地静态服务：`python3 -m http.server 8020`（项目根）
2. `node shot.mjs` —— Playwright 逐页截图到 /tmp/pptbuild/shots/（需 playwright + chromium）
3. `python3 assemble.py` —— python-pptx 组装，备注取 index.html 内 SPEAKER_NOTES

截图依赖 `node_modules` 可解析到 playwright；`ln -s <dsh node_modules> node_modules` 即可。

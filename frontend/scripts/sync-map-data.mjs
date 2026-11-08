#!/usr/bin/env node
/**
 * 把仓库根目录的北京全域数据包（data/parcels/beijing_full，PR-36 数据提交 333946c）
 * 同步到 frontend/public/data/，供前端以静态 JSON 直读（不经后端、不发明新 API）。
 * public/data 已加入 frontend/.gitignore，不重复入库；predev / prebuild / prestart 自动运行。
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const PARCELS = ["beijing_full", "beijing_core"];
const FILES = [
  "parcel.json",
  "buildings.json",
  "network.json",
  "labels.json",
  "LICENSE.txt",
];

let copied = 0;
for (const p of PARCELS) {
  const src = join(FRONTEND, "..", "data", "parcels", p);
  const dst = join(FRONTEND, "public", "data", "parcels", p);
  if (!existsSync(src)) {
    console.warn(
      `⚠ 未找到 ${src}：全域地图将显示加载失败（请先 git pull 数据包）`,
    );
    continue;
  }
  mkdirSync(dst, { recursive: true });
  for (const f of FILES) {
    const s = join(src, f);
    const d = join(dst, f);
    if (!existsSync(s)) continue;
    if (
      existsSync(d) &&
      statSync(d).size === statSync(s).size &&
      statSync(d).mtimeMs >= statSync(s).mtimeMs
    )
      continue;
    copyFileSync(s, d);
    copied++;
  }
}
console.log(`✓ map data synced (${copied} file(s) updated)`);

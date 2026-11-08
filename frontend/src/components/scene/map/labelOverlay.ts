/**
 * 地名标签 DOM 叠加层（PR-36）：LOD + 投影 + 贪心避让 + 节点池复用。纯 DOM 逻辑，不依赖 React。
 * LOD（按相机到标签的距离）：importance 5 始终可见；4 在 <45km；3 在 <9km；同屏最多 300 个，按 importance 优先、贪心避让。
 */
import * as THREE from "three";
import type { MapLabel } from "@/lib/map/types";

export const MAX_VISIBLE_LABELS = 300;
const COLOR: Record<number, string> = {
  5: "color:#8a6200;font-weight:700",
  4: "color:#1f5f9e;font-weight:600",
  3: "color:#22746b;font-weight:600",
};
/** 字号随相机距离分三档：近看街区时字大，拉远看全城时字小（与建筑在屏幕上的大小一致） */
const FONT: Record<number, [number, number, number]> = {
  5: [12, 15, 19],
  4: [10, 13, 16],
  3: [9, 12, 15],
};

export function labelVisible(importance: number, distance: number) {
  return (
    importance >= 5 ||
    (importance === 4 && distance < 45000) ||
    (importance === 3 && distance < 9000)
  );
}

export class LabelOverlay {
  private pool: HTMLDivElement[] = [];
  private v = new THREE.Vector3();

  constructor(
    private layer: HTMLDivElement,
    private labels: MapLabel[],
  ) {}

  /** topInset：顶部留给 HUD 的像素带，不放标签 */
  update(camera: THREE.Camera, width: number, height: number, topInset = 0) {
    const cam = camera.position;
    const placed: [number, number, number, number][] = [];
    let used = 0;
    for (const l of this.labels) {
      if (used >= MAX_VISIBLE_LABELS) break;
      const dist = Math.hypot(l.x - cam.x, l.y - cam.y, l.z - cam.z);
      if (!labelVisible(l.importance, dist)) continue;
      const p = this.v.set(l.x, l.y, l.z).project(camera);
      if (p.z < -1 || p.z > 1) continue;
      const x = ((p.x + 1) / 2) * width;
      const y = ((1 - p.y) / 2) * height;
      const w = l.name.length * (l.importance >= 5 ? 16 : 13) + 16;
      const lh = 22;
      const x0 = x - w / 2;
      const y0 = y - lh;
      if (x0 + w < 0 || x0 > width || y0 < topInset || y0 > height) continue;
      if (
        placed.some(
          ([a, b, c, d]) => x0 < c && x0 + w > a && y0 < d && y0 + lh > b,
        )
      )
        continue;
      placed.push([x0, y0, x0 + w, y0 + lh]);
      const node = this.node(used);
      if (node.textContent !== l.name) node.textContent = l.name;
      const imp = Math.min(5, l.importance);
      const tier = dist > 22000 ? 0 : dist > 9000 ? 1 : 2;
      const size = (FONT[imp] ?? FONT[3])[tier];
      const style = `font-size:${size}px;${COLOR[imp] ?? COLOR[3]}`;
      if (node.dataset.s !== style) {
        node.style.cssText = style;
        node.dataset.s = style;
      }
      node.style.transform = `translate(${Math.round(x0)}px, ${Math.round(y0)}px)`;
      node.style.display = "block";
      used++;
    }
    for (let i = used; i < this.pool.length; i++)
      this.pool[i].style.display = "none";
    this.layer.dataset.visible = String(used);
  }

  private node(i: number): HTMLDivElement {
    let n = this.pool[i];
    if (!n) {
      n = document.createElement("div");
      n.className = "city20-map-label";
      this.layer.appendChild(n);
      this.pool.push(n);
    }
    return n;
  }

  dispose() {
    for (const n of this.pool) n.remove();
    this.pool = [];
  }
}

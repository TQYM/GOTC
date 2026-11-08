/**
 * 全域拾取（PR-36）：视线与「地表 + 格内建筑顶高」高程场求交（变步长步进 + 二分）。
 * 不对 73 万格地形或 7 万栋建筑做三角面射线求交，开销与地图规模无关；命中点再经 cells 索引映射回建筑。
 */

export interface Ray3 {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

/**
 * 返回首个「视线低于高程场」的参数 t（世界米），没有命中返回 null。
 * heightAt(wx, wz) 返回世界坐标点处的表面高度（地表或建筑顶）。
 */
export function marchHeightfield(
  ray: Ray3,
  heightAt: (wx: number, wz: number) => number,
  near = 10,
  far = 600000,
): number | null {
  const o = ray.origin;
  const d = ray.direction;
  const above = (t: number) =>
    o.y + d.y * t - heightAt(o.x + d.x * t, o.z + d.z * t);
  let prev = 0;
  for (let t = near; t < far; t += Math.max(15, t * 0.006)) {
    if (above(t) < 0) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    prev = t;
  }
  return null;
}

/** 每格建筑顶高（米，相对地表）：格 → 建筑下标 → 高度；空格为 0 */
export function cellTopHeights(
  cellIndex: Int32Array,
  height: Float32Array,
): Float32Array {
  const out = new Float32Array(cellIndex.length);
  for (let i = 0; i < cellIndex.length; i++) {
    const b = cellIndex[i];
    if (b >= 0) out[i] = height[b];
  }
  return out;
}

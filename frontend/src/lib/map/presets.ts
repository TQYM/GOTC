/**
 * 预设导航（全景 / CBD / 故宫 / 鸟巢 / 乡村 / 西山），机位沿用 tools/preview/beijing.html，换算到以地图中心为原点的世界坐标。
 */
import { mapFrame, mapToWorld, type Surface } from "@/components/scene/coords";
import type { FullMapData } from "./types";

export type PresetKey =
  "all" | "cbd" | "gugong" | "niaochao" | "village" | "mountain";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "all", label: "全景" },
  { key: "cbd", label: "CBD" },
  { key: "gugong", label: "故宫" },
  { key: "niaochao", label: "鸟巢" },
  { key: "village", label: "乡村" },
  { key: "mountain", label: "西山" },
];

export interface CameraShot {
  pos: [number, number, number];
  target: [number, number, number];
}

export function presetShot(
  key: PresetKey,
  data: FullMapData,
  surface: Surface,
): CameraShot {
  const f = mapFrame(data.grid);
  const at = (
    x: number,
    y: number,
    dx: number,
    dh: number,
    dz: number,
    th = 0,
  ): CameraShot => {
    const [wx, wz] = mapToWorld(f, x, y);
    const g = surface.heightAt(x, y);
    return { pos: [wx + dx, g + dh, wz + dz], target: [wx, g + th, wz] };
  };
  switch (key) {
    case "all":
      return { pos: [0, 185000, 165000], target: [0, 0, 12000] };
    case "mountain":
      return { pos: [-45000, 22000, -30000], target: [-55000, 800, -45000] };
    case "village":
      if (data.village)
        return at(data.village[0], data.village[1], 1200, 1500, 1600);
      return presetShot("all", data, surface);
    default: {
      const lm = data.landmarks.find(
        (l) => l.key === (key === "cbd" ? "zun" : key),
      );
      if (!lm) return presetShot("all", data, surface);
      return at(lm.x, lm.y, 2000, 2600, 2600, 150);
    }
  }
}

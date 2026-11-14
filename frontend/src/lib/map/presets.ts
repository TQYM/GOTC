/**
 * 预设导航（全景 / CBD / 故宫 / 鸟巢 / 乡村 / 西山），机位沿用 tools/preview/beijing.html，换算到以地图中心为原点的世界坐标。
 */
import { mapFrame, mapToWorld, type Surface } from "@/components/scene/coords";
import { coreRectWorld } from "./coreArea";
import type { FullMapData } from "./types";

export type PresetKey =
  "all" | "cbd" | "gugong" | "niaochao" | "village" | "mountain";

/**
 * 管理范围是东西朝海，预设只给出核心区内的四个机位；
 * village / mountain 保留 key 供历史链接与测试使用，但不再出现在按钮里。
 */
export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "all", label: "东西朝海" },
  { key: "cbd", label: "CBD" },
  { key: "gugong", label: "故宫" },
  { key: "niaochao", label: "鸟巢" },
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
    case "all": {
      // 核心区俯视。48km 棋盘若从 55km 高空看，20m 的楼只剩 0.04% 视高，
      // 整片会摊成彩色色块；压到 span*0.22（约 10km 高）才能看出楼是立体的。
      const core = coreRectWorld(f);
      const span = Math.max(core.halfX, core.halfZ) * 2;
      return {
        pos: [core.centerX, span * 0.22, core.centerZ + span * 0.26],
        target: [core.centerX, 0, core.centerZ - span * 0.02],
      };
    }
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

import { describe, expect, it } from "vitest";
import {
  labelVisible,
  MAX_VISIBLE_LABELS,
} from "@/components/scene/map/labelOverlay";
import { cellTopHeights, marchHeightfield } from "@/lib/map/pick";
import { BUILDING_PART, LOD_DISTANCE } from "@/lib/map/types";

describe("label LOD", () => {
  it("shows importance 5 always, 4 under 45km, 3 under 9km, capped at 300", () => {
    expect(labelVisible(5, 400000)).toBe(true);
    expect(labelVisible(4, 44999)).toBe(true);
    expect(labelVisible(4, 45000)).toBe(false);
    expect(labelVisible(3, 8999)).toBe(true);
    expect(labelVisible(3, 9000)).toBe(false);
    expect(labelVisible(2, 10)).toBe(false);
    expect(MAX_VISIBLE_LABELS).toBe(300);
  });
});

describe("building LOD tiers", () => {
  it("uses the 5 / 15 / 30 km boundaries", () => {
    expect(LOD_DISTANCE).toEqual({
      fine: 5000,
      medium: 15000,
      noDetail: 30000,
    });
    expect(Object.keys(BUILDING_PART)).toEqual([
      "base",
      "mid",
      "fine",
      "simple",
      "landmark",
      "boardLandmark",
    ]);
  });
});

describe("heightfield picking", () => {
  it("hits flat ground straight below the camera", () => {
    const t = marchHeightfield(
      { origin: { x: 0, y: 1000, z: 0 }, direction: { x: 0, y: -1, z: 0 } },
      () => 0,
    );
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(1000, 0);
  });

  it("stops on a building roof before reaching the ground behind it", () => {
    const s = Math.SQRT1_2;
    // 视线 45° 向下，x∈[400,600] 处有一栋 300m 高楼
    const height = (x: number) => (x >= 400 && x <= 600 ? 300 : 0);
    const t = marchHeightfield(
      { origin: { x: 0, y: 600, z: 0 }, direction: { x: s, y: -s, z: 0 } },
      (x) => height(x),
    );
    expect(t).not.toBeNull();
    const hitX = s * t!;
    expect(hitX).toBeGreaterThanOrEqual(399);
    expect(hitX).toBeLessThan(600);
  });

  it("returns null when looking at the sky", () => {
    expect(
      marchHeightfield(
        { origin: { x: 0, y: 10, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
        () => 0,
        10,
        5000,
      ),
    ).toBeNull();
  });

  it("maps building heights onto cells", () => {
    const tops = cellTopHeights(
      Int32Array.from([-1, 1, 0]),
      Float32Array.from([10, 99]),
    );
    expect(Array.from(tops)).toEqual([0, 99, 10]);
  });
});

describe("board anchor on the full map", () => {
  it("puts the CBD board's 中国尊 on top of the full-map 中国尊 (±20m)", async () => {
    const { boardAnchorOnMap } = await import("@/components/scene/coords");
    const fullBbox = { south: 39.4, west: 115.6 };
    for (const origin of [[451876.29, 4416801.3], null]) {
      const a = boardAnchorOnMap(fullBbox, {
        size: 48,
        cell_size_m: 50,
        origin,
      });
      // CBD 局部 (1998.1, 1280.5) → 全域；全域数据包里中国尊中心 (74411.6, 55972.8)
      const x = a.x - a.half + 1998.1;
      const y = a.y - a.half + 1280.5;
      expect(Math.abs(x - 74411.6)).toBeLessThan(20);
      expect(Math.abs(y - 55972.8)).toBeLessThan(20);
      expect(a.half).toBe(1200);
    }
  });
});

import { describe, expect, it } from "vitest";
import { TILE_SPECS } from "@/lib/catalog";
import type { Parcel, Terrain } from "@/lib/contract";
import { checkPlacement } from "@/lib/validate";
import { makeState } from "./fixtures";

function bridgeParcel(): Parcel {
  const terrain = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => "flat" as Terrain));
  for (const [r, c, value] of [
    [2, 0, "bank"], [2, 1, "river"], [2, 2, "river"], [2, 3, "bank"],
    [0, 4, "bank"], [1, 4, "river"], [2, 4, "bank"],
  ] as [number, number, Terrain][]) terrain[r][c] = value;
  return { ...makeState().parcel, size: 5, terrain };
}

describe("桥梁预览与 catalog 占格一致", () => {
  it("东西向锚定西岸，包含连续河道和东岸", () => {
    const result = checkPlacement(bridgeParcel(), new Set(), 10_000_000, "util_bridge", [2, 0], "horizontal");
    if (!result.ok) throw new Error(result.reason ?? "放置失败");
    expect(result.cells).toEqual([[2, 0], [2, 1], [2, 2], [2, 3]]);
    expect(result.cost).toBe(TILE_SPECS.util_bridge.cost * 4);
  });

  it("南北向锚定北岸，包含南岸", () => {
    const result = checkPlacement(bridgeParcel(), new Set(), 10_000_000, "util_bridge", [0, 4], "vertical");
    if (!result.ok) throw new Error(result.reason ?? "放置失败");
    expect(result.cells).toEqual([[0, 4], [1, 4], [2, 4]]);
    expect(result.cost).toBe(TILE_SPECS.util_bridge.cost * 3);
  });

  it("河道不能作为锚点，普通地块仍使用原占地规则", () => {
    expect(checkPlacement(bridgeParcel(), new Set(), 10_000_000, "util_bridge", [2, 1], "horizontal").ok).toBe(false);
    const house = checkPlacement(bridgeParcel(), new Set(), 10_000_000, "res_low", [0, 0]);
    if (!house.ok) throw new Error(house.reason ?? "住宅放置失败");
    expect(house.cells).toEqual([[0, 0]]);
  });
});

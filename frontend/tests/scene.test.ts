import { describe, expect, it } from "vitest";
import {
  cellToWorld,
  flattenActiveAssets,
  getCellBounds,
  getPlacementCells,
  worldToCell,
} from "../lib/scene";
import type { Anchor, BuildingsFile, ExistingAsset } from "../lib/types";

function makeAsset(assetId: string): ExistingAsset {
  return {
    asset_id: assetId,
    category: "residential",
    height_m: 12,
    levels: 4,
    footprint: [[0, 0], [20, 0], [20, 20], [0, 20]],
    cells: [[0, 0]],
    base_area_m2: 400,
    population: 10,
    jobs: 0,
    demolition_cost: 1000,
    upkeep: 100,
    height_source: "test",
  };
}

describe("grid/world coordinates", () => {
  it("maps northern rows to negative world z and returns exact cell centers", () => {
    expect(cellToWorld([0, 0], 4, 10)).toEqual([-15, -15]);
    expect(cellToWorld([0, 3], 4, 10)).toEqual([15, -15]);
    expect(cellToWorld([3, 0], 4, 10)).toEqual([-15, 15]);
    expect(cellToWorld([3, 3], 4, 10)).toEqual([15, 15]);

    const anchors: Anchor[] = [[0, 0], [0, 3], [1, 2], [3, 0], [3, 3]];
    for (const anchor of anchors) {
      const center = cellToWorld(anchor, 4, 10);
      expect(center).not.toBeNull();
      if (center) expect(worldToCell(center[0], center[1], 4, 10)).toEqual(anchor);
    }
  });

  it("uses inclusive north/west edges and exclusive south/east edges", () => {
    expect(worldToCell(-20, -20, 4, 10)).toEqual([0, 0]);
    expect(worldToCell(-10, -10, 4, 10)).toEqual([1, 1]);
    expect(worldToCell(19.999, 19.999, 4, 10)).toEqual([3, 3]);
    expect(worldToCell(20, 0, 4, 10)).toBeNull();
    expect(worldToCell(0, 20, 4, 10)).toBeNull();
    expect(worldToCell(-20.001, 0, 4, 10)).toBeNull();
    expect(worldToCell(0, -20.001, 4, 10)).toBeNull();
  });

  it("rejects non-finite coordinates and invalid grid parameters", () => {
    expect(worldToCell(Number.NaN, 0, 4, 10)).toBeNull();
    expect(worldToCell(0, Number.POSITIVE_INFINITY, 4, 10)).toBeNull();
    expect(worldToCell(0, 0, 0, 10)).toBeNull();
    expect(worldToCell(0, 0, 4, 0)).toBeNull();
    expect(worldToCell(0, 0, 4.5, 10)).toBeNull();
  });

  it("rejects out-of-bounds and fractional anchors in both directions", () => {
    const invalid: Anchor[] = [
      [-1, 0], [0, -1], [4, 0], [0, 4], [1.5, 0], [0, 1.5],
      [Number.NaN, 0], [0, Number.POSITIVE_INFINITY],
    ];
    for (const anchor of invalid) expect(cellToWorld(anchor, 4, 10)).toBeNull();
    expect(cellToWorld([0, 0], 0, 10)).toBeNull();
    expect(cellToWorld([0, 0], 4, -10)).toBeNull();
  });
});

describe("active existing assets", () => {
  const first = makeAsset("asset-a");
  const removed = makeAsset("asset-b");
  const last = makeAsset("asset-c");
  const file: BuildingsFile = {
    parcel_id: "beijing_cbd",
    chunks: {
      "0:0": [first, removed],
      "1:0": [last],
    },
  };

  it("flattens chunks in order and filters all redeveloped asset ids", () => {
    expect(flattenActiveAssets(file, ["asset-b", "not-present"])).toEqual([first, last]);
    expect(flattenActiveAssets(file, new Set(["asset-a", "asset-c"]))).toEqual([removed]);
    expect(file.chunks["0:0"]).toEqual([first, removed]);
  });

  it("handles absent files and fully redeveloped data", () => {
    expect(flattenActiveAssets(null, [])).toEqual([]);
    expect(flattenActiveAssets(undefined, [])).toEqual([]);
    expect(flattenActiveAssets(file, ["asset-a", "asset-b", "asset-c"])).toEqual([]);
  });
});

describe("multi-cell bounds", () => {
  it("uses actual cells rather than assuming a footprint from the anchor", () => {
    expect(getCellBounds([[4, 5], [4, 6], [5, 5], [5, 6]], 48)).toEqual({
      minRow: 4,
      maxRow: 5,
      minColumn: 5,
      maxColumn: 6,
    });
    expect(getCellBounds([[2, 8], [2, 9], [2, 10], [-1, 9]], 48)).toEqual({
      minRow: 2,
      maxRow: 2,
      minColumn: 8,
      maxColumn: 10,
    });
    expect(getCellBounds([[-1, 0], [48, 0]], 48)).toBeNull();
  });

  it("expands regular placement previews from their north-west anchor", () => {
    expect(getPlacementCells([5, 6], "ind_heavy")).toEqual([
      [5, 6], [5, 7], [5, 8],
      [6, 6], [6, 7], [6, 8],
      [7, 6], [7, 7], [7, 8],
    ]);
    expect(getPlacementCells([47, 47], "com_cbd")).toEqual([
      [47, 47], [47, 48], [48, 47], [48, 48],
    ]);
  });
});

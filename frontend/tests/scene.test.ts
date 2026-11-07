import { describe, expect, it } from "vitest";
import {
  cellToWorld,
  createExistingAssetChunks,
  createExistingBuildingGeometries,
  createLandmarkLabelLayouts,
  createNetworkGeometries,
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

  it("extrudes canonical local-metre footprints without mirroring north/south", () => {
    const layers = createExistingBuildingGeometries([makeAsset("asset-a")], 100);
    expect(layers).toHaveLength(1);
    layers[0].geometry.computeBoundingBox();
    const bounds = layers[0].geometry.boundingBox!;
    expect(bounds.min.x).toBeCloseTo(-50);
    expect(bounds.max.x).toBeCloseTo(-30);
    expect(bounds.min.z).toBeCloseTo(30);
    expect(bounds.max.z).toBeCloseTo(50);
    expect(bounds.min.y).toBeCloseTo(0.28);
    expect(bounds.max.y).toBeCloseTo(12.28);
    for (const layer of layers) layer.geometry.dispose();
  });

  it("builds frustum chunks and removes redeveloped assets from their bounds", () => {
    const file: BuildingsFile = { parcel_id: "beijing_cbd", chunks: { "0:0": [makeAsset("a"), makeAsset("b")] } };
    expect(createExistingAssetChunks(file, [], 100)[0].assets).toHaveLength(2);
    expect(createExistingAssetChunks(file, ["a", "b"], 100)).toEqual([]);
  });
});

describe("canonical network geometry", () => {
  it("uses highway widths and keeps north-edge paths in the correct world quadrant", () => {
    const geometries = createNetworkGeometries({
      parcel_id: "beijing_cbd",
      features: [
        { feature_id: "road", kind: "road", highway: "primary", path: [[0, 0], [100, 0]] },
        { feature_id: "rail", kind: "rail", path: [[0, 20], [100, 20]] },
      ],
    }, 100);
    expect(geometries.roads).not.toBeNull();
    geometries.roads!.computeBoundingBox();
    const road = geometries.roads!.boundingBox!;
    expect(road.min.x).toBeCloseTo(-50);
    expect(road.max.x).toBeCloseTo(50);
    expect(road.min.z).toBeCloseTo(43); // primary = 14m，北缘中心 z=50
    expect(road.max.z).toBeCloseTo(57);
    expect(geometries.rails).not.toBeNull();
    geometries.roads!.dispose();
    geometries.rails!.dispose();
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

describe("landmark labels", () => {
  it("uses actual roof heights, north-edge coordinates and importance order", () => {
    const tower = { ...makeAsset("tower"), name: "中国尊", height_m: 528 };
    const file: BuildingsFile = { parcel_id: "beijing_cbd", chunks: { "0:0": [tower] } };
    const layouts = createLandmarkLabelLayouts({
      labels: [
        { name: "普通站点", kind: "station", pos: [100, 200], importance: 4 },
        { name: "中国尊", kind: "landmark", pos: [1200, 1200], importance: 5 },
        { name: "低优先级", kind: "shop", pos: [10, 10], importance: 3 },
        { name: "界外", kind: "school", pos: [2401, 10], importance: 5 },
      ],
    }, file, 2400);
    expect(layouts.map((layout) => layout.label.name)).toEqual(["中国尊", "普通站点"]);
    expect(layouts[0].position).toEqual([0, 552, 0]);
    expect(layouts[1].position).toEqual([-1100, 95, 1000]);
  });

  it("sorts before applying the display limit", () => {
    const layouts = createLandmarkLabelLayouts({
      labels: [
        { name: "次重要", kind: "station", pos: [1, 1], importance: 4 },
        { name: "最重要", kind: "landmark", pos: [2, 2], importance: 5 },
      ],
    }, { parcel_id: "beijing_cbd", chunks: {} }, 100, 1);
    expect(layouts).toHaveLength(1);
    expect(layouts[0].label.name).toBe("最重要");
  });
});

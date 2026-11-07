import {
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Shape,
  Vector2,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type {
  Anchor,
  BuildingsFile,
  ExistingAsset,
  NetworkFile,
  Parcel,
  Terrain,
  TileType,
} from "./types";

/** A point on the Three.js ground plane: [worldX, worldZ]. */
export type WorldPoint = [number, number];

export interface CellBounds {
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
}

export interface TerrainGeometries {
  solid: BufferGeometry;
  water: BufferGeometry | null;
}

export interface ExistingBuildingGeometry {
  category: ExistingAsset["category"];
  geometry: BufferGeometry;
}

export interface NetworkGeometries {
  roads: BufferGeometry | null;
  rails: BufferGeometry | null;
}

const TERRAIN_HEIGHTS: Record<Terrain, number> = {
  flat: 0,
  hill: 4,
  river: -1.4,
  bank: -0.25,
  forest: 0.8,
  road_inherited: -0.1,
  occupied: 0.25,
};

const TERRAIN_COLORS: Record<Terrain, string> = {
  flat: "#a9c795",
  hill: "#91ad7f",
  river: "#477f96",
  bank: "#b9bd91",
  forest: "#6fa679",
  road_inherited: "#9b9f9b",
  occupied: "#b6b2a7",
};

const BUILDING_CATEGORIES: ExistingAsset["category"][] = [
  "residential",
  "workplace",
  "industrial",
  "civic",
];

function isValidGrid(size: number, cellSize: number): boolean {
  return Number.isInteger(size) && size > 0 && Number.isFinite(cellSize) && cellSize > 0;
}

function isValidAnchor(anchor: Anchor, size: number): boolean {
  const [row, column] = anchor;
  return (
    Number.isInteger(row) &&
    Number.isInteger(column) &&
    row >= 0 &&
    column >= 0 &&
    row < size &&
    column < size
  );
}

/**
 * Convert a Three.js ground-plane intersection to an `[row, column]` anchor.
 * The north/west edges are inclusive; south/east outer edges are exclusive.
 */
export function worldToCell(
  worldX: number,
  worldZ: number,
  size: number,
  cellSize: number,
): Anchor | null {
  if (!isValidGrid(size, cellSize) || !Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
    return null;
  }

  const half = (size * cellSize) / 2;
  if (worldX < -half || worldX >= half || worldZ < -half || worldZ >= half) {
    return null;
  }

  const column = Math.floor((worldX + half) / cellSize);
  const row = Math.floor((worldZ + half) / cellSize);
  return isValidAnchor([row, column], size) ? [row, column] : null;
}

/** Convert a valid `[row, column]` anchor to its cell center's `[worldX, worldZ]`. */
export function cellToWorld(
  anchor: Anchor,
  size: number,
  cellSize: number,
): WorldPoint | null {
  if (!isValidGrid(size, cellSize) || !isValidAnchor(anchor, size)) {
    return null;
  }

  const [row, column] = anchor;
  const half = (size * cellSize) / 2;
  return [
    (column + 0.5) * cellSize - half,
    (row + 0.5) * cellSize - half,
  ];
}

/** Flatten building chunks and remove every asset scheduled for redevelopment. */
export function flattenActiveAssets(
  file: BuildingsFile | null | undefined,
  redevelopedAssetIds: Iterable<string>,
): ExistingAsset[] {
  if (!file) return [];
  const redeveloped = new Set(redevelopedAssetIds);
  return Object.values(file.chunks)
    .flat()
    .filter((asset) => !redeveloped.has(asset.asset_id));
}

export function terrainHeight(terrain: Terrain): number {
  return TERRAIN_HEIGHTS[terrain];
}

/** Regular tile footprints; bridge extent needs an orientation not present in scene props. */
export function getTileSpan(type: TileType): { rows: number; columns: number } {
  switch (type) {
    case "com_cbd":
    case "ind_light":
    case "green_plaza":
    case "edu_school":
    case "med_clinic":
      return { rows: 2, columns: 2 };
    case "ind_heavy":
      return { rows: 3, columns: 3 };
    default:
      return { rows: 1, columns: 1 };
  }
}

export function getPlacementCells(anchor: Anchor, type: TileType): Anchor[] {
  const { rows, columns } = getTileSpan(type);
  const cells: Anchor[] = [];
  for (let rowOffset = 0; rowOffset < rows; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < columns; columnOffset += 1) {
      cells.push([anchor[0] + rowOffset, anchor[1] + columnOffset]);
    }
  }
  return cells;
}

/** Bounds are derived from actual tile.cells, rather than assumed from its anchor/type. */
export function getCellBounds(cells: readonly Anchor[], size: number): CellBounds | null {
  let bounds: CellBounds | null = null;
  for (const anchor of cells) {
    if (!isValidAnchor(anchor, size)) continue;
    const [row, column] = anchor;
    if (!bounds) {
      bounds = { minRow: row, maxRow: row, minColumn: column, maxColumn: column };
    } else {
      bounds.minRow = Math.min(bounds.minRow, row);
      bounds.maxRow = Math.max(bounds.maxRow, row);
      bounds.minColumn = Math.min(bounds.minColumn, column);
      bounds.maxColumn = Math.max(bounds.maxColumn, column);
    }
  }
  return bounds;
}

interface MutableGeometryData {
  positions: number[];
  colors: number[];
  indices: number[];
}

type Corner = [number, number, number];

function emptyGeometryData(): MutableGeometryData {
  return { positions: [], colors: [], indices: [] };
}

/** Append a two-triangle quad. Corner order is chosen to face outwards/upwards. */
function appendQuad(data: MutableGeometryData, corners: [Corner, Corner, Corner, Corner], color: Color) {
  const offset = data.positions.length / 3;
  for (const [x, y, z] of corners) {
    data.positions.push(x, y, z);
    data.colors.push(color.r, color.g, color.b);
  }
  data.indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
}

function toGeometry(data: MutableGeometryData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(data.colors, 3));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendCellPrism(
  data: MutableGeometryData,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  top: number,
  base: number,
  topColor: Color,
) {
  const sideColor = topColor.clone().multiplyScalar(0.7);
  appendQuad(
    data,
    [
      [x0, top, z0],
      [x0, top, z1],
      [x1, top, z0],
      [x1, top, z1],
    ],
    topColor,
  );
  appendQuad(data, [[x0, top, z0], [x1, top, z0], [x0, base, z0], [x1, base, z0]], sideColor);
  appendQuad(data, [[x1, top, z1], [x0, top, z1], [x1, base, z1], [x0, base, z1]], sideColor);
  appendQuad(data, [[x0, top, z1], [x0, top, z0], [x0, base, z1], [x0, base, z0]], sideColor);
  appendQuad(data, [[x1, top, z0], [x1, top, z1], [x1, base, z0], [x1, base, z1]], sideColor);
}

/** Build one solid terrain draw call and at most one transparent water draw call. */
export function createTerrainGeometries(parcel: Parcel): TerrainGeometries {
  const { size, cell_size_m: cellSize } = parcel;
  const half = (size * cellSize) / 2;
  const base = -4;
  const solid = emptyGeometryData();
  const water = emptyGeometryData();
  const waterColor = new Color("#5bb4cf");
  let hasWater = false;

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const terrain = parcel.terrain[row]?.[column] ?? "flat";
      const x0 = column * cellSize - half;
      const x1 = x0 + cellSize;
      const z0 = row * cellSize - half;
      const z1 = z0 + cellSize;
      const color = new Color(TERRAIN_COLORS[terrain]);
      const variation = 0.985 + ((row * 31 + column * 17) % 5) * 0.0075;
      color.multiplyScalar(variation);
      appendCellPrism(solid, x0, x1, z0, z1, terrainHeight(terrain), base, color);

      if (terrain === "river") {
        hasWater = true;
        const waterY = -0.55;
        appendQuad(
          water,
          [
            [x0, waterY, z0],
            [x0, waterY, z1],
            [x1, waterY, z0],
            [x1, waterY, z1],
          ],
          waterColor,
        );
      }
    }
  }

  return { solid: toGeometry(solid), water: hasWater ? toGeometry(water) : null };
}

function footprintPoints(asset: ExistingAsset): Vector2[] {
  if (!Array.isArray(asset.footprint)) return [];
  const points: Vector2[] = [];
  for (const point of asset.footprint) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const previous = points[points.length - 1];
    if (previous && previous.x === point[0] && previous.y === point[1]) continue;
    points.push(new Vector2(point[0], point[1]));
  }
  if (points.length > 1 && points[0].equals(points[points.length - 1])) points.pop();
  return points;
}

/** Extrude real local-metre footprints and merge into at most four geometries. */
export function createExistingBuildingGeometries(
  assets: readonly ExistingAsset[],
  worldSize: number,
): ExistingBuildingGeometry[] {
  const half = worldSize / 2;
  const result: ExistingBuildingGeometry[] = [];

  for (const category of BUILDING_CATEGORIES) {
    const temporary: ExtrudeGeometry[] = [];
    try {
      for (const asset of assets) {
        if (asset.category !== category) continue;
        const points = footprintPoints(asset);
        if (points.length < 3) continue;
        const fallbackHeight = Number.isFinite(asset.levels) ? Math.max(3, asset.levels * 3.2) : 6;
        const height = Number.isFinite(asset.height_m) && asset.height_m > 0
          ? asset.height_m
          : fallbackHeight;
        const geometry = new ExtrudeGeometry(new Shape(points), {
          depth: height,
          bevelEnabled: false,
          steps: 1,
          curveSegments: 1,
        });
        // Shape x/y are east/north; extrusion z becomes world up.
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(-half, terrainHeight("occupied") + 0.03, half);
        temporary.push(geometry);
      }

      if (temporary.length > 0) {
        const merged = mergeGeometries(temporary, false);
        if (merged) {
          merged.computeBoundingSphere();
          result.push({ category, geometry: merged });
        }
      }
    } finally {
      for (const geometry of temporary) geometry.dispose();
    }
  }

  return result;
}

function positionsToLineGeometry(positions: number[]): BufferGeometry | null {
  if (positions.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Build two batched line geometries, without remote map/GIS requests. */
export function createNetworkGeometries(file: NetworkFile, worldSize: number): NetworkGeometries {
  const half = worldSize / 2;
  const roads: number[] = [];
  const rails: number[] = [];

  for (const feature of file.features) {
    if (!Array.isArray(feature.path) || feature.path.length < 2) continue;
    const kind = feature.kind.toLowerCase();
    const target = kind.includes("rail") || kind.includes("subway") || kind.includes("metro")
      ? rails
      : kind.includes("road")
        ? roads
        : null;
    if (!target) continue;
    const y = target === rails ? 1.05 : 0.65;

    for (let index = 1; index < feature.path.length; index += 1) {
      const start = feature.path[index - 1];
      const end = feature.path[index];
      if (
        !Number.isFinite(start[0]) || !Number.isFinite(start[1]) ||
        !Number.isFinite(end[0]) || !Number.isFinite(end[1])
      ) continue;
      target.push(
        start[0] - half, y, half - start[1],
        end[0] - half, y, half - end[1],
      );
    }
  }

  return { roads: positionsToLineGeometry(roads), rails: positionsToLineGeometry(rails) };
}

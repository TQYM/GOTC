import {
  Box3,
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Frustum,
  Matrix4,
  Shape,
  Vector2,
  Vector3,
} from "three";
import type { Camera } from "three";
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

export interface ExistingAssetChunk {
  key: string;
  assets: ExistingAsset[];
  bounds: Box3;
}

export interface NetworkGeometries {
  roads: BufferGeometry | null;
  rails: BufferGeometry | null;
}

export interface SceneLabel {
  name: string;
  kind: string;
  pos: [number, number];
  importance: number;
}

export interface LandmarkLabelLayout {
  label: SceneLabel;
  position: [number, number, number];
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

/** Regular rectangular tile footprints; bridges use bridgePlacementCells instead. */
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

/** Expand bank → one or more river cells → bank in the requested direction. */
export function bridgePlacementCells(
  parcel: Parcel,
  anchor: Anchor,
  orientation: "horizontal" | "vertical",
): Anchor[] {
  if (!isValidAnchor(anchor, parcel.size)) return [];
  const [startRow, startColumn] = anchor;
  if (parcel.terrain[startRow]?.[startColumn] !== "bank") return [];

  const cells: Anchor[] = [[startRow, startColumn]];
  let row = startRow;
  let column = startColumn;
  let crossedRiver = false;
  while (true) {
    if (orientation === "horizontal") column += 1;
    else row += 1;
    if (row < 0 || column < 0 || row >= parcel.size || column >= parcel.size) return [];
    const terrain = parcel.terrain[row]?.[column];
    if (terrain === "river") {
      crossedRiver = true;
      cells.push([row, column]);
      continue;
    }
    if (terrain === "bank" && crossedRiver) {
      cells.push([row, column]);
      return cells;
    }
    return [];
  }
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

function existingAssetHeight(asset: ExistingAsset): number {
  const fallbackHeight = Number.isFinite(asset.levels) ? Math.max(3, asset.levels * 3.2) : 6;
  return Number.isFinite(asset.height_m) && asset.height_m > 0 ? asset.height_m : fallbackHeight;
}

/** Keep chunk identity so expensive extrusion can be deferred until a chunk is visible. */
export function createExistingAssetChunks(
  file: BuildingsFile,
  redevelopedAssetIds: Iterable<string>,
  worldSize: number,
): ExistingAssetChunk[] {
  const redeveloped = new Set(redevelopedAssetIds);
  const half = worldSize / 2;
  const baseY = terrainHeight("occupied") + 0.03;
  const chunks: ExistingAssetChunk[] = [];

  for (const [key, chunkAssets] of Object.entries(file.chunks)) {
    const assets = chunkAssets.filter((asset) => !redeveloped.has(asset.asset_id));
    if (assets.length === 0) continue;
    const bounds = new Box3();
    bounds.makeEmpty();
    const point = new Vector3();
    let maxHeight = 0;

    for (const asset of assets) {
      maxHeight = Math.max(maxHeight, existingAssetHeight(asset));
      for (const footprintPoint of footprintPoints(asset)) {
        point.set(footprintPoint.x - half, baseY, half - footprintPoint.y);
        bounds.expandByPoint(point);
      }
    }
    if (bounds.isEmpty()) continue;
    bounds.min.y = baseY;
    bounds.max.y = baseY + maxHeight;
    chunks.push({ key, assets, bounds });
  }

  return chunks;
}

/** Select on-frustum chunks, expanding their boxes to preload adjacent chunks. */
export function getVisibleChunkKeys(
  chunks: readonly ExistingAssetChunk[],
  camera: Camera,
  neighborMargin = 0,
): string[] {
  camera.updateMatrixWorld();
  const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new Frustum().setFromProjectionMatrix(projection);
  const margin = Number.isFinite(neighborMargin) ? Math.max(0, neighborMargin) : 0;
  const expanded = new Box3();
  return chunks
    .filter((chunk) => frustum.intersectsBox(expanded.copy(chunk.bounds).expandByScalar(margin)))
    .map((chunk) => chunk.key);
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
        const geometry = new ExtrudeGeometry(new Shape(points), {
          depth: existingAssetHeight(asset),
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

/** Merge cached visible chunks back into four draw calls without disposing cache entries. */
export function mergeExistingBuildingLayers(
  chunks: readonly (readonly ExistingBuildingGeometry[])[],
): ExistingBuildingGeometry[] {
  const result: ExistingBuildingGeometry[] = [];
  for (const category of BUILDING_CATEGORIES) {
    const geometries: BufferGeometry[] = [];
    for (const chunk of chunks) {
      for (const layer of chunk) {
        if (layer.category === category) geometries.push(layer.geometry);
      }
    }
    if (geometries.length === 0) continue;
    const geometry = geometries.length === 1
      ? geometries[0].clone()
      : mergeGeometries(geometries, false);
    if (geometry) {
      geometry.computeBoundingSphere();
      result.push({ category, geometry });
    }
  }
  return result;
}

interface MutableStripData {
  positions: number[];
  indices: number[];
}

function emptyStripData(): MutableStripData {
  return { positions: [], indices: [] };
}

function appendNetworkStrip(
  data: MutableStripData,
  start: [number, number],
  end: [number, number],
  half: number,
  width: number,
  y: number,
) {
  const startX = start[0] - half;
  const startZ = half - start[1];
  const endX = end[0] - half;
  const endZ = half - end[1];
  const dx = endX - startX;
  const dz = endZ - startZ;
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length < 0.001) return;
  const offsetX = (-dz / length) * (width / 2);
  const offsetZ = (dx / length) * (width / 2);
  const offset = data.positions.length / 3;
  data.positions.push(
    startX - offsetX, y, startZ - offsetZ,
    startX + offsetX, y, startZ + offsetZ,
    endX - offsetX, y, endZ - offsetZ,
    endX + offsetX, y, endZ + offsetZ,
  );
  data.indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
}

function toStripGeometry(data: MutableStripData): BufferGeometry | null {
  if (data.positions.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function roadWidth(level: string | undefined): number {
  switch (level?.toLowerCase()) {
    case "motorway":
    case "trunk":
    case "primary":
      return 14;
    case "secondary":
      return 11;
    case "tertiary":
      return 9;
    case "service":
    case "living_street":
      return 6;
    default:
      return 8;
  }
}

/** Build batched, upward-facing road and rail strip meshes above the terrain surface. */
export function createNetworkGeometries(file: NetworkFile, worldSize: number): NetworkGeometries {
  const half = worldSize / 2;
  const roads = emptyStripData();
  const rails = emptyStripData();

  for (const feature of file.features) {
    if (!Array.isArray(feature.path) || feature.path.length < 2) continue;
    const kind = feature.kind.toLowerCase();
    const isRail = kind.includes("rail") || kind.includes("subway") || kind.includes("metro");
    const isRoad = kind.includes("road");
    if (!isRail && !isRoad) continue;
    const target = isRail ? rails : roads;
    const width = isRail ? (kind.includes("subway") || kind.includes("metro") ? 7 : 5) : roadWidth(feature.highway ?? feature.level ?? undefined);
    // Different physical heights plus material polygon offset prevent coplanar flicker.
    const y = isRail ? 0.32 : 0.14;

    for (let index = 1; index < feature.path.length; index += 1) {
      const start = feature.path[index - 1];
      const end = feature.path[index];
      if (
        !Number.isFinite(start[0]) || !Number.isFinite(start[1]) ||
        !Number.isFinite(end[0]) || !Number.isFinite(end[1])
      ) continue;
      appendNetworkStrip(target, start, end, half, width, y);
    }
  }

  return { roads: toStripGeometry(roads), rails: toStripGeometry(rails) };
}

/** Prioritize labels and place named landmarks above the actual asset roof. */
export function createLandmarkLabelLayouts(
  file: { labels: SceneLabel[] },
  buildings: BuildingsFile,
  worldSize: number,
  limit = 40,
): LandmarkLabelLayout[] {
  if (!Number.isFinite(worldSize) || worldSize <= 0) return [];
  const half = worldSize / 2;
  const heights = new Map<string, number>();
  for (const asset of Object.values(buildings.chunks).flat()) {
    if (!asset.name || !Number.isFinite(asset.height_m) || asset.height_m <= 0) continue;
    heights.set(asset.name, Math.max(heights.get(asset.name) ?? 0, asset.height_m));
  }
  return file.labels
    .filter((label) => (
      label.importance >= 4 && label.name &&
      Array.isArray(label.pos) && label.pos.length === 2 &&
      label.pos.every((value) => Number.isFinite(value) && value >= 0 && value <= worldSize)
    ))
    .sort((a, b) => b.importance - a.importance || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((label) => ({
      label,
      position: [
        label.pos[0] - half,
        (heights.get(label.name) ?? 71) + 24,
        half - label.pos[1],
      ],
    }));
}

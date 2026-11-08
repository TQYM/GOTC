/**
 * 本地放置预校验（05 §3.1）：只做体验层——地形表 + 已占用格 + 资金缓存。
 * 最终以后端错误协议为准（阶段、并发占用等前端无法知道）。规则口径：01 §2/§3、02 §2.2、11 §5。
 */
import type { Cell, Parcel, Terrain, TileType } from "./contract";
import { TILE_SPECS } from "./catalog";
import { yuan } from "./api/humanize";

export interface PlacementCheck {
  cells: Cell[];
  cost: number;
  ok: boolean;
  /** 不合法时的人话原因（14 §1.3：红框旁说明具体原因） */
  reason: string | null;
  code: "invalid_placement" | "cell_occupied" | "insufficient_funds" | null;
  /** 合法但值得提醒（如砍林地） */
  warning: string | null;
}

const TERRAIN_REASON: Partial<Record<Terrain, string>> = {
  river: "河道上不能建，桥才行",
  road_inherited: "这是保留的既有道路，不能占用",
  occupied: "这块是既有建筑，先拆迁",
};

/** 桥：锚点是西/北 bank，沿方向穿过至少一格 river，落在东/南 bank；覆盖格包含两岸。 */
function bridgeCells(
  parcel: Parcel,
  [r, c]: Cell,
  orientation: "horizontal" | "vertical",
): Cell[] {
  if (parcel.terrain[r]?.[c] !== "bank") return [[r, c]];
  const dr = orientation === "vertical" ? 1 : 0;
  const dc = orientation === "horizontal" ? 1 : 0;
  const cells: Cell[] = [[r, c]];
  let rr = r + dr;
  let cc = c + dc;
  if (parcel.terrain[rr]?.[cc] !== "river") return [...cells, [rr, cc]];
  while (parcel.terrain[rr]?.[cc] === "river") {
    cells.push([rr, cc]);
    rr += dr;
    cc += dc;
  }
  cells.push([rr, cc]);
  return cells;
}

function validBridge(parcel: Parcel, cells: Cell[]): boolean {
  if (cells.length < 3) return false;
  const first = cells[0];
  const last = cells[cells.length - 1];
  return parcel.terrain[first[0]]?.[first[1]] === "bank" &&
    parcel.terrain[last[0]]?.[last[1]] === "bank" &&
    cells.slice(1, -1).every(([r, c]) => parcel.terrain[r]?.[c] === "river");
}

export function expandCells(
  parcel: Parcel,
  type: TileType,
  anchor: Cell,
  orientation: "horizontal" | "vertical" = "horizontal",
): Cell[] {
  if (type === "util_bridge") return bridgeCells(parcel, anchor, orientation);
  const [h, w] = TILE_SPECS[type].footprint;
  const out: Cell[] = [];
  for (let dr = 0; dr < h; dr++)
    for (let dc = 0; dc < w; dc++) out.push([anchor[0] + dr, anchor[1] + dc]);
  return out;
}

/** 造价：覆盖格比例分摊总价，丘陵格 ×1.5；桥按格计价（与后端 placement_cost 同口径） */
export function estimateCost(
  parcel: Parcel,
  type: TileType,
  cells: Cell[],
): number {
  const spec = TILE_SPECS[type];
  if (type === "util_bridge") return spec.cost * cells.length;
  const n = cells.length;
  const hill = cells.filter(
    ([r, c]) => parcel.terrain[r]?.[c] === "hill",
  ).length;
  return Math.floor((spec.cost * (2 * (n - hill) + 3 * hill)) / (2 * n));
}

/** 拆除返还 = ceil(造价 × 30%)（02 §3.4） */
export function estimateRefund(
  parcel: Parcel,
  type: TileType,
  cells: Cell[],
): number {
  return Math.ceil((estimateCost(parcel, type, cells) * 30) / 100);
}

export function occupiedKey(r: number, c: number) {
  return r * 1000 + c;
}

export function checkPlacement(
  parcel: Parcel,
  occupied: ReadonlySet<number>,
  funds: number | null,
  type: TileType,
  anchor: Cell,
  orientation: "horizontal" | "vertical" = "horizontal",
): PlacementCheck {
  const cells = expandCells(parcel, type, anchor, orientation);
  const cost = estimateCost(parcel, type, cells);
  const fail = (
    code: PlacementCheck["code"],
    reason: string,
  ): PlacementCheck => ({
    cells,
    cost,
    ok: false,
    reason,
    code,
    warning: null,
  });

  if (
    cells.some(
      ([r, c]) => r < 0 || c < 0 || r >= parcel.size || c >= parcel.size,
    )
  ) {
    return fail("invalid_placement", "超出地块范围了");
  }
  const isGreen = TILE_SPECS[type].category === "green";
  let warning: string | null = null;
  if (type === "util_bridge") {
    if (!validBridge(parcel, cells))
      return fail("invalid_placement", "桥要从西/北岸锚点穿过连续河面，到对岸 bank 落地");
  } else {
    for (const [r, c] of cells) {
      const t = parcel.terrain[r][c];
      if (TERRAIN_REASON[t])
        return fail("invalid_placement", TERRAIN_REASON[t]!);
      if (t === "bank" && !isGreen)
        return fail("invalid_placement", "河岸绿线内只能建公园或广场");
      if (t === "forest") warning = "会砍掉林地，市民可能不满";
    }
  }
  if (cells.some(([r, c]) => occupied.has(occupiedKey(r, c)))) {
    return fail("cell_occupied", "这块地已经有建筑了");
  }
  if (funds !== null && cost > funds) {
    return fail("insufficient_funds", `钱不够了，还差 ${yuan(cost - funds)}`);
  }
  return { cells, cost, ok: true, reason: null, code: null, warning };
}

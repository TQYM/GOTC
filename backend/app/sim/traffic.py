"""交通（03 §4.7–4.8）：需求分配 → 路径负载 → BPR → avg_commute / congestion。

实现口径（03 文档未完全定量处，均已在 PR-07 描述披露）：
- 需求分配：每座住宅全部入住 → 最近岗位区块（并列取岗位多者，再按放置顺序）。
- 路径：Dijkstra，代价 inherited_road/trans_road=1、其余空格=1.4（体现"优先走道路"）；
  建筑覆盖格不可通行（端点豁免）；river 仅 util_bridge 覆盖格可通行。
- 地铁：住宅锚点 600m（12 格）内有地铁站 → 该住宅通勤固定 8 分钟，不再走路径。
- 不可达：该住宅按曼哈顿自由流时间计入 avg_commute；不可达入住占比 >5% 再 +20 分钟。
- 无岗位区块时无通勤需求，avg_commute=0、congestion=0。
"""

import heapq
from dataclasses import dataclass

from app.config import SimConfig
from app.contracts.parcel import Parcel, Terrain
from app.contracts.tile import Tile, TileType
from app.sim.population import ResStat, manhattan
from app.sim.transit import TransitManager

JOB_TYPES = {TileType.COM_SHOP, TileType.COM_CBD, TileType.IND_LIGHT, TileType.IND_HEAVY}
_ROAD_COST = 1.0
_GAP_COST = 1.4
MAX_COMMUTE_MIN = 120  # 03 §4.7 上限截断


@dataclass(frozen=True)
class TrafficResult:
    avg_commute: int
    congestion: float
    unreachable_share: float


def _passable_and_cost(
    parcel: Parcel, tiles: list[Tile], config: SimConfig
) -> tuple[list[list[bool]], list[list[float]], list[list[int]]]:
    """格网：可通行性、路径代价、通行能力（省道 1500 / 普通 800，03 §8）。"""
    size = parcel.size
    tc = config.traffic
    bridge_cells: set[tuple[int, int]] = set()
    built_cells: set[tuple[int, int]] = set()
    for tile in tiles:
        cells = {tuple(c) for c in tile.cells}
        if tile.type is TileType.UTIL_BRIDGE:
            bridge_cells |= cells
        elif tile.type not in (TileType.TRANS_ROAD, TileType.TRANS_AVENUE,
                                TileType.TRANS_HIGHWAY, TileType.TRANS_METRO):
            built_cells |= cells

    passable = [[True] * size for _ in range(size)]
    cost = [[_GAP_COST] * size for _ in range(size)]
    capacity = [[tc.road_capacity] * size for _ in range(size)]
    # 道路等级（C:S 的两车道/四车道/高速）：容量与代价逐级改善。
    _ROAD_TYPES = {
        TileType.TRANS_ROAD: (1.0, 1.0),
        TileType.TRANS_AVENUE: (2.0, 0.85),
        TileType.TRANS_HIGHWAY: (3.0, 0.70),
    }
    road_level: dict[tuple[int, int], TileType] = {}
    for tile in tiles:
        if tile.type in _ROAD_TYPES:
            for cell in tile.cells:
                road_level[tuple(cell)] = tile.type
    for r in range(size):
        for c in range(size):
            t = parcel.terrain[r][c]
            if t is Terrain.RIVER and (r, c) not in bridge_cells:
                passable[r][c] = False
                continue
            if (r, c) in built_cells:
                passable[r][c] = False
                continue
            level = road_level.get((r, c))
            if t is Terrain.ROAD_INHERITED or level is not None:
                cost[r][c] = _ROAD_COST * (_ROAD_TYPES[level][1] if level else 1.0)
            if t is Terrain.ROAD_INHERITED:
                capacity[r][c] = tc.highway_capacity
            elif level is not None:
                scale, _ = _ROAD_TYPES[level]
                capacity[r][c] = int(tc.road_capacity * scale)
    return passable, cost, capacity


def _dijkstra_to_nearest_job(
    start: tuple[int, int],
    job_anchors: set[tuple[int, int]],
    passable: list[list[bool]],
    cost: list[list[float]],
) -> list[tuple[int, int]] | None:
    """从住宅锚点到最近岗位锚点的路径（含起点终点）；不可达返回 None。"""
    size = len(passable)
    sr, sc = start
    dist = {(sr, sc): 0.0}
    parent: dict[tuple[int, int], tuple[int, int]] = {}
    heap = [(0.0, sr, sc)]
    visited = set()
    while heap:
        d, r, c = heapq.heappop(heap)
        if (r, c) in visited:
            continue
        visited.add((r, c))
        if (r, c) in job_anchors and (r, c) != start:
            path = [(r, c)]
            while path[-1] != start:
                path.append(parent[path[-1]])
            path.reverse()
            return path
        for dr, dc in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nr, nc = r + dr, c + dc
            if not (0 <= nr < size and 0 <= nc < size) or (nr, nc) in visited:
                continue
            # 端点豁免：岗位锚点即使被建筑覆盖也可进入
            if not passable[nr][nc] and (nr, nc) not in job_anchors:
                continue
            nd = d + cost[nr][nc]
            if nd < dist.get((nr, nc), float("inf")):
                dist[(nr, nc)] = nd
                parent[(nr, nc)] = (r, c)
                heapq.heappush(heap, (nd, nr, nc))
    return None


def compute_traffic(
    parcel: Parcel,
    tiles: list[Tile],
    stats: list[ResStat],
    config: SimConfig,
    transit: TransitManager | None = None,
    commute_mult: float = 1.0,
) -> TrafficResult:
    """全量交通重算：先分配负载，再按负载算 BPR 时间（单趟不迭代）。

    公共交通优先：若住宅与它最近的岗位之间能通过**同一条线路**的两个站
    接驳，且总时间（两端步行 + 乘车）优于或等于步行上限，则改走公交/地铁，
    不再占用道路负载——这正是 C:S 里修一条地铁能缓解拥堵的原因。
    """
    tc = config.traffic
    job_tiles = [t for t in tiles if t.type in JOB_TYPES]
    total_occ = sum(s.occupancy for s in stats)
    if not job_tiles or total_occ <= 0:
        return TrafficResult(avg_commute=0, congestion=0.0, unreachable_share=0.0)

    # 注意：地铁站本身不载客——只有「线路接驳」才替代通勤。
    # 旧逻辑「600m 内有地铁站 → 固定 8 分钟」会把站点当线路，已移除。
    passable, cost, capacity = _passable_and_cost(parcel, tiles, config)
    job_anchors = {tuple(t.anchor) for t in job_tiles}

    stop_cells = {t.id: tuple(t.anchor) for t in tiles if t.type is TileType.TRANS_METRO}
    # 第一遍：分配需求，累计格负载
    loads: dict[tuple[int, int], float] = {}
    assignments: list[tuple[ResStat, list[tuple[int, int]] | None]] = []
    transit_times: dict[int, float] = {}
    unreachable_occ = 0.0
    for index, s in enumerate(stats):
        if transit is not None and job_anchors:
            nearest_job = min(job_anchors, key=lambda a: manhattan(list(s.anchor), list(a)))
            ride = transit.best_transit_minutes(tuple(s.anchor), nearest_job, stop_cells)
            if ride is not None and ride <= MAX_COMMUTE_MIN:
                transit_times[index] = ride
                assignments.append((s, []))
                continue
        path = _dijkstra_to_nearest_job(s.anchor, job_anchors, passable, cost)
        assignments.append((s, path))
        if path is None:
            unreachable_occ += s.occupancy
        else:
            for cell in path[1:-1]:  # 起点与终点都不计负载（终点是建筑格，不是道路）
                loads[cell] = loads.get(cell, 0.0) + s.occupancy

    # 第二遍：BPR 计时
    alpha, beta = tc.bpr_alpha, tc.bpr_beta
    t0 = tc.base_road_time_min

    def cell_time(cell: tuple[int, int]) -> float:
        v = loads.get(cell, 0.0)
        cap = capacity[cell[0]][cell[1]] or tc.road_capacity
        return t0 * (1 + alpha * (v / cap) ** beta)

    weighted = 0.0
    for index, (s, path) in enumerate(assignments):
        if path == []:  # 公交线路或地铁
            time_min = transit_times.get(index, float(tc.metro_fixed_commute_min))
        elif path is None:  # 不可达：曼哈顿自由流估计
            nearest = min(manhattan(list(s.anchor), list(a)) for a in job_anchors)
            time_min = nearest * t0
        else:
            time_min = sum(cell_time(cell) for cell in path[1:])
        weighted += time_min * commute_mult * s.occupancy

    avg = weighted / total_occ
    unreachable_share = unreachable_occ / total_occ
    if unreachable_share > tc.unreachable_share_threshold:
        avg += tc.unreachable_penalty_min
    congestion = max(
        (v / (capacity[r][c] or tc.road_capacity) for (r, c), v in loads.items()),
        default=0.0,
    )
    return TrafficResult(
        avg_commute=min(MAX_COMMUTE_MIN, round(avg)),
        congestion=round(congestion, 4),
        unreachable_share=round(unreachable_share, 4),
    )

"""区块目录（01 §3）：14 种区块的静态规格表。

引擎与 API 共用的唯一出处；造价/占地/维护费改这里（并同步 01 §3 与 03 §8）。
"""

from dataclasses import dataclass

from app.contracts.parcel import Terrain
from app.contracts.tile import TileType


@dataclass(frozen=True)
class TileSpec:
    type: TileType
    name: str
    category: str  # 住宅/商业/工业/绿地/公共服务/交通/市政
    footprint: tuple[int, int]  # (高, 宽)，格数
    cost: int  # 总造价（元，01 §3 表）；多格按覆盖格比例分摊
    upkeep: int  # 年维护费（元/年，03 §8 表）


CATALOG: dict[TileType, TileSpec] = {
    t.type: t
    for t in [
        TileSpec(TileType.RES_LOW, "低层住宅", "住宅", (1, 1), 80_000, 8_000),
        TileSpec(TileType.RES_MID, "多层住宅", "住宅", (1, 1), 220_000, 12_000),
        TileSpec(TileType.RES_HIGH, "高层住宅", "住宅", (1, 1), 600_000, 30_000),
        TileSpec(TileType.COM_SHOP, "社区商业", "商业", (1, 1), 300_000, 30_000),
        TileSpec(TileType.COM_CBD, "商务中心", "商业", (2, 2), 2_200_000, 150_000),
        TileSpec(TileType.IND_LIGHT, "轻工业", "工业", (2, 2), 1_500_000, 100_000),
        TileSpec(TileType.IND_HEAVY, "重工业", "工业", (3, 3), 4_000_000, 200_000),
        TileSpec(TileType.GREEN_PARK, "公园绿地", "绿地", (1, 1), 150_000, 5_000),
        TileSpec(TileType.GREEN_PLAZA, "城市广场", "绿地", (2, 2), 500_000, 15_000),
        TileSpec(TileType.EDU_SCHOOL, "学校", "公共服务", (2, 2), 1_200_000, 80_000),
        TileSpec(TileType.MED_CLINIC, "医院", "公共服务", (2, 2), 2_000_000, 120_000),
        TileSpec(TileType.TRANS_METRO, "地铁站", "交通", (1, 1), 3_000_000, 200_000),
        TileSpec(TileType.TRANS_ROAD, "城市道路", "交通", (1, 1), 60_000, 2_000),
        # util_bridge 为 1×N（N=跨河最短连续格数，01 §3），锚点展开在 PR-07 特判，桩按 1×1
        TileSpec(TileType.UTIL_BRIDGE, "跨河桥", "市政", (1, 1), 200_000, 10_000),
    ]
}

GREEN_TYPES = {TileType.GREEN_PARK, TileType.GREEN_PLAZA}


def expand_cells(tile_type: TileType, anchor: list[int]) -> list[list[int]]:
    """由锚点 + 占地形状展开覆盖格列表（左上锚点，01 §3）。"""
    r, c = anchor
    h, w = CATALOG[tile_type].footprint
    return [[r + dr, c + dc] for dr in range(h) for dc in range(w)]


def placement_cost(tile_type: TileType, cells: list[list[int]], terrain) -> int:
    """造价 = 覆盖格比例分摊总造价；丘陵覆盖格按 ×1.5 计（01 §3 / 03 §4.1）。

    整式计算保证全平原时恰好等于目录总价（如重工业 3×3 = 4,000,000）。
    """
    spec = CATALOG[tile_type]
    n = len(cells)
    if tile_type is TileType.UTIL_BRIDGE:
        return spec.cost * n  # 桥按格计价（01 §3：200,000/格），无丘陵加成
    hill_n = sum(1 for r, c in cells if terrain[r][c] is Terrain.HILL)
    flat_n = n - hill_n
    return (spec.cost * (2 * flat_n + 3 * hill_n)) // (2 * n)


def bridge_cells(parcel, anchor: list[int]) -> list[list[int]]:
    """跨河桥展开（01 §3：1×N，N=跨河最短连续格数）。

    锚点必须落在 river 格；沿该行向两侧扩展覆盖整段连续河道。
    锚点非河道或越界时抛 ValueError，由会话层转 invalid_placement。
    """
    r, c = anchor
    size = parcel.size
    if not (0 <= r < size and 0 <= c < size) or parcel.terrain[r][c] is not Terrain.RIVER:
        raise ValueError("跨河桥锚点必须落在河道格上")
    left = c
    while left - 1 >= 0 and parcel.terrain[r][left - 1] is Terrain.RIVER:
        left -= 1
    right = c
    while right + 1 < size and parcel.terrain[r][right + 1] is Terrain.RIVER:
        right += 1
    return [[r, cc] for cc in range(left, right + 1)]

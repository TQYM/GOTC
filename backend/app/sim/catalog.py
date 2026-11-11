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
        TileSpec(TileType.SRV_POLICE, "警察局", "市政服务", (2, 2), 800_000, 60_000),
        TileSpec(TileType.SRV_FIRE, "消防局", "市政服务", (2, 2), 900_000, 70_000),
        TileSpec(TileType.SRV_GARBAGE, "垃圾处理厂", "市政服务", (2, 2), 700_000, 55_000),
        TileSpec(TileType.SRV_SEWAGE, "污水处理厂", "市政服务", (2, 2), 1_000_000, 65_000),
        TileSpec(TileType.SRV_POWER, "发电厂", "市政服务", (2, 2), 1_600_000, 110_000),
        TileSpec(TileType.SRV_WATER, "自来水厂", "市政服务", (2, 2), 1_200_000, 90_000),
        TileSpec(TileType.TRANS_METRO, "地铁站", "交通", (1, 1), 3_000_000, 200_000),
        TileSpec(TileType.TRANS_ROAD, "城市道路", "交通", (1, 1), 60_000, 2_000),
        TileSpec(TileType.TRANS_AVENUE, "城市大道", "交通", (1, 1), 120_000, 4_000),
        TileSpec(TileType.TRANS_HIGHWAY, "城市高速", "交通", (1, 1), 240_000, 8_000),
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


def bridge_cells(
    parcel, anchor: list[int], orientation: str
) -> list[list[int]]:
    """跨河桥展开（01 §3）：西/北侧 bank 锚点，1×N 且包含两岸。

    水平桥向东、垂直桥向南，中间必须至少经过一格连续 river；任一
    非河道格提前出现、缺少对岸 bank 或越界都使整次放置失败。
    """
    if orientation not in ("horizontal", "vertical"):
        raise ValueError("跨河桥必须指定 horizontal/vertical 方向")
    r, c = anchor
    size = parcel.size
    if not (0 <= r < size and 0 <= c < size) or parcel.terrain[r][c] is not Terrain.BANK:
        raise ValueError("跨河桥锚点必须落在西侧或北侧河岸格上")
    dr, dc = (0, 1) if orientation == "horizontal" else (1, 0)
    cells = [[r, c]]
    r, c = r + dr, c + dc
    while 0 <= r < size and 0 <= c < size and parcel.terrain[r][c] is Terrain.RIVER:
        cells.append([r, c])
        r, c = r + dr, c + dc
    if len(cells) == 1:
        raise ValueError("跨河桥必须至少覆盖一格河道")
    if not (0 <= r < size and 0 <= c < size) or parcel.terrain[r][c] is not Terrain.BANK:
        raise ValueError("跨河桥必须连续跨河并连接另一侧河岸")
    cells.append([r, c])
    return cells

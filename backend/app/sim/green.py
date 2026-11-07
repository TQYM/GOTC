"""绿地率（03 §4.6）：(绿地类区块格 + 未铲除 forest 格) ÷ 全城总格数。"""

from app.contracts.parcel import Parcel, Terrain
from app.contracts.tile import Tile, TileType

GREEN_TYPES = {TileType.GREEN_PARK, TileType.GREEN_PLAZA}


def green_cells(parcel: Parcel, tiles: list[Tile]) -> set[tuple[int, int]]:
    """绿地格集合：公园/广场覆盖格 ∪ 未被任何区块覆盖的 forest 格（并集去重）。"""
    built: set[tuple[int, int]] = set()
    greens: set[tuple[int, int]] = set()
    for tile in tiles:
        cells = {(r, c) for r, c in tile.cells}
        built |= cells
        if tile.type in GREEN_TYPES:
            greens |= cells
    for r, row in enumerate(parcel.terrain):
        for c, t in enumerate(row):
            if t is Terrain.FOREST and (r, c) not in built:
                greens.add((r, c))
    return greens


def green_ratio(parcel: Parcel, tiles: list[Tile]) -> float:
    return round(len(green_cells(parcel, tiles)) / (parcel.size * parcel.size), 4)

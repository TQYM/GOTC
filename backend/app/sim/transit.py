"""公共交通线路（对齐 C:S TransportManager / TransportLine / TransportStation）。

C:S 的公共交通结构：
- **线路（TransportLine）**：一条有颜色的线，站点有序排列，有名字、票价
- **站点（TransportStation）**：`TransportManager` 里的 `m_lines` 与站点索引
- **车辆（Vehicle）**：在线上按 `m_averageInterval` 发车
- 玩家操作：画线（`TransportTool`）→ 加站（`m_hoverStopIndex`）→ 设票价

CITY20 的映射：
- 线路 = 有序的 tile 序列（站点必须已有 `trans_metro` 地块）
- 三种制式：公交（bus）/ 地铁（metro）
- 通勤加成：起点与终点 600m 内有**同一条线**的站，走该线的时间替代步行时间

为什么用「线路」而不是「站点半径」：C:S 的公共交通不是「覆盖圈」，
而是「你画的那条线」——乘客只能沿线的顺序移动。这是它和公园/学校
最本质的区别，也是玩家调线路的原因。
"""

from __future__ import annotations

from dataclasses import dataclass, field

# 制式参数：站间时间（分钟）、造价、票价上限
LINE_KINDS: dict[str, dict[str, float | str]] = {
    "bus": {"label": "公交", "minutes_per_stop": 2.0, "cost": 60_000, "max_price": 3.0},
    "metro": {"label": "地铁", "minutes_per_stop": 1.2, "cost": 240_000, "max_price": 6.0},
}

MAX_LINES = 64
MAX_STOPS_PER_LINE = 32
WALK_TO_STOP_M = 600  # 与 coverage.py 的 COVERAGE_RADIUS_M 同值
CELL_M = 50


@dataclass
class TransitLine:
    lid: int
    name: str
    kind: str
    stops: list[str] = field(default_factory=list)
    color: str = "#3D8BFF"
    price: float = 2.0
    passengers: int = 0  # 上一年的客运量（统计用）

    def to_dict(self) -> dict:
        return {
            "lid": self.lid,
            "name": self.name,
            "kind": self.kind,
            "stops": list(self.stops),
            "color": self.color,
            "price": round(self.price, 2),
            "passengers": self.passengers,
            "stops_count": len(self.stops),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TransitLine":
        return cls(
            lid=int(data["lid"]),
            name=str(data["name"]),
            kind=str(data["kind"]),
            stops=list(data.get("stops", [])),
            color=str(data.get("color", "#3D8BFF")),
            price=float(data.get("price", 2.0)),
            passengers=int(data.get("passengers", 0)),
        )


class TransitManager:
    """线路集合。id 单调递增，与 C:S 的 `m_lines` 索引一致。"""

    def __init__(self) -> None:
        self.lines: dict[int, TransitLine] = {}
        self._next_id: int = 1

    # ---- 线路 ----
    def create_line(
        self, name: str, kind: str, stops: list[str], color: str = "#3D8BFF"
    ) -> TransitLine | None:
        if kind not in LINE_KINDS or len(self.lines) >= MAX_LINES:
            return None
        stops = stops[:MAX_STOPS_PER_LINE]
        if len(stops) < 2:
            return None
        line = TransitLine(
            lid=self._next_id,
            name=name or f"{LINE_KINDS[kind]['label']}线 {self._next_id}",
            kind=kind,
            stops=stops,
            color=color,
        )
        self.lines[line.lid] = line
        self._next_id += 1
        return line

    def add_stop(self, lid: int, tile_id: str, index: int | None = None) -> bool:
        line = self.lines.get(lid)
        if line is None or len(line.stops) >= MAX_STOPS_PER_LINE:
            return False
        if tile_id in line.stops:
            return False
        if index is None or index >= len(line.stops):
            line.stops.append(tile_id)
        else:
            line.stops.insert(max(0, index), tile_id)
        return True

    def remove_stop(self, lid: int, tile_id: str) -> bool:
        line = self.lines.get(lid)
        if line is None or tile_id not in line.stops:
            return False
        line.stops.remove(tile_id)
        return True

    def delete_line(self, lid: int) -> bool:
        return self.lines.pop(lid, None) is not None

    def set_price(self, lid: int, price: float) -> bool:
        line = self.lines.get(lid)
        if line is None:
            return False
        cap = float(LINE_KINDS[line.kind]["max_price"])
        line.price = max(0.0, min(cap, price))
        return True

    # ---- 查询 ----
    def lines_at(self, tile_id: str) -> list[TransitLine]:
        return [line for line in self.lines.values() if tile_id in line.stops]

    def walk_minutes(self) -> float:
        """步行到站的时间（600m ≈ 8 分钟，5km/h）。"""
        return WALK_TO_STOP_M / 1000.0 / 5.0 * 60.0

    def ride_minutes(self, line: TransitLine, from_stop: str, to_stop: str) -> float | None:
        """沿线的站间时间；两端不在同一条线上返回 None。"""
        if from_stop not in line.stops or to_stop not in line.stops:
            return None
        a = line.stops.index(from_stop)
        b = line.stops.index(to_stop)
        hops = abs(b - a)
        if hops == 0:
            return None
        return hops * float(LINE_KINDS[line.kind]["minutes_per_stop"])

    def best_transit_minutes(
        self,
        home_cell: tuple[int, int],
        job_cell: tuple[int, int],
        stop_cells: dict[str, tuple[int, int]],
    ) -> float | None:
        """起点/终点附近是否有同一条线的两个站；返回含步行换乘的总时间。

        `stop_cells` 是 `{tile_id: (row, col)}`，由调用方从地块表构建。
        """
        radius = WALK_TO_STOP_M / CELL_M  # 12 格
        home_stops = [
            tile_id
            for tile_id, cell in stop_cells.items()
            if abs(cell[0] - home_cell[0]) + abs(cell[1] - home_cell[1]) <= radius
        ]
        if not home_stops:
            return None
        job_stops = [
            tile_id
            for tile_id, cell in stop_cells.items()
            if abs(cell[0] - job_cell[0]) + abs(cell[1] - job_cell[1]) <= radius
        ]
        if not job_stops:
            return None

        walk = self.walk_minutes()
        best: float | None = None
        for line in self.lines.values():
            for home in home_stops:
                if home not in line.stops:
                    continue
                for job in job_stops:
                    ride = self.ride_minutes(line, home, job)
                    if ride is None:
                        continue
                    total = walk * 2 + ride
                    if best is None or total < best:
                        best = total
        return best

    def coverage_ratio(self, homes: list[str], jobs: list[str]) -> float:
        """有线路覆盖的住宅+岗位占比（喂给统计与前端）。"""
        if not homes and not jobs:
            return 0.0
        covered = sum(1 for tile in homes + jobs if self.lines_at(tile))
        return covered / (len(homes) + len(jobs))

    # ---- 快照 ----
    def to_snapshot(self) -> dict:
        return {
            "next_id": self._next_id,
            "lines": [line.to_dict() for line in self.lines.values()],
        }

    @classmethod
    def from_snapshot(cls, data: dict | None) -> "TransitManager":
        manager = cls()
        if not data:
            return manager
        manager._next_id = int(data.get("next_id", 1))
        for row in data.get("lines", []):
            line = TransitLine.from_dict(row)
            manager.lines[line.lid] = line
        return manager

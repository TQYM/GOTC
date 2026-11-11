"""行政区与政策（对齐 C:S DistrictManager / DistrictPolicies）。

C:S 的行政区：
- 用刷子在路网上圈任意形状，`DistrictManager.CreateDistrict(out byte district)`
- id 是 **byte**（最多 256 个区），数组 `m_districts` 与 `m_parks` 并列
- 每个区有名字（`SetDistrictName`）与一组政策（`SetDistrictPolicy` / `UnsetDistrictPolicy`）
- 政策是**位标志**，同一类互斥（如高税 vs 低税）

CITY20 用矩形近似形状（与 zone 刷子一致），政策收敛为 6 条：
- `tax_raise` / `tax_lower`：本区住宅税率 ±2 个百分点
- `no_heavy_industry`：本区禁止重工业落成
- `green`：本区污染 -20%，幸福 +3
- `education_boost`：本区教育升级概率 +20%
- `industry_boost`：本区工业岗位 +15%

政策作用点在 `CityState._recompute`：把 `district_effects()` 的聚合值
喂给 engine（税率、幸福、污染）与 `_try_build`（禁建）。
"""

from __future__ import annotations

from dataclasses import dataclass, field

# 政策表：name -> 效果
POLICIES: dict[str, dict[str, float | str]] = {
    "tax_raise": {"label": "高税率", "tax_delta": 2.0},
    "tax_lower": {"label": "低税率", "tax_delta": -2.0},
    "no_heavy_industry": {"label": "限制重工业", "block": "ind_heavy"},
    "green": {"label": "绿色城区", "pollution_delta": -0.20, "happiness": 3.0},
    "education_boost": {"label": "教育优先", "edu_bonus": 0.20},
    "industry_boost": {"label": "工业扶持", "jobs_mult": 0.15},
}

# 互斥组：同一组只能选一个
EXCLUSIVE = [{"tax_raise", "tax_lower"}]

MAX_DISTRICTS = 256  # C:S 的 id 是 byte，上限 256


@dataclass
class District:
    did: int
    name: str
    tiles: set[str] = field(default_factory=set)
    policies: set[str] = field(default_factory=set)

    def to_dict(self) -> dict:
        return {
            "did": self.did,
            "name": self.name,
            "tiles": sorted(self.tiles),
            "policies": sorted(self.policies),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "District":
        return cls(
            did=int(data["did"]),
            name=str(data["name"]),
            tiles=set(data.get("tiles", [])),
            policies=set(data.get("policies", [])),
        )


class DistrictManager:
    """区集合。id 单调递增，不复用（C:S 同样只增不减）。"""

    def __init__(self) -> None:
        self.districts: dict[int, District] = {}
        self._next_id: int = 1

    def create(self, name: str, tiles: list[str]) -> District | None:
        if len(self.districts) >= MAX_DISTRICTS:
            return None
        district = District(
            did=self._next_id,
            name=name or f"区 {self._next_id}",
            tiles=set(tiles),
        )
        self.districts[district.did] = district
        self._next_id += 1
        return district

    def assign(self, did: int, tiles: list[str]) -> bool:
        district = self.districts.get(did)
        if district is None:
            return False
        district.tiles.update(tiles)
        return True

    def remove(self, did: int) -> bool:
        return self.districts.pop(did, None) is not None

    def set_policy(self, did: int, policy: str, enabled: bool) -> bool:
        district = self.districts.get(did)
        if district is None or policy not in POLICIES:
            return False
        if enabled:
            for group in EXCLUSIVE:
                if policy in group:
                    district.policies -= group - {policy}
            district.policies.add(policy)
        else:
            district.policies.discard(policy)
        return True

    def district_of(self, tile_id: str) -> District | None:
        for district in self.districts.values():
            if tile_id in district.tiles:
                return district
        return None

    # ---- 聚合效果 ----
    def effects(self, tile_types: dict[str, str]) -> dict:
        """按地块类型聚合政策效果。

        `tile_types` 是 `{tile_id: type}`，用于判断「本区是否有重工业」。
        """
        tax_delta = 0.0
        pollution_delta = 0.0
        happiness = 0.0
        edu_bonus = 0.0
        jobs_mult = 0.0
        blocked: set[str] = set()
        for district in self.districts.values():
            count = len(district.tiles)
            if count == 0:
                continue
            for policy in district.policies:
                spec = POLICIES.get(policy, {})
                tax_delta += float(spec.get("tax_delta", 0.0))
                pollution_delta += float(spec.get("pollution_delta", 0.0))
                happiness += float(spec.get("happiness", 0.0))
                edu_bonus += float(spec.get("edu_bonus", 0.0))
                jobs_mult += float(spec.get("jobs_mult", 0.0))
                block = spec.get("block")
                if isinstance(block, str):
                    blocked.add(block)
        return {
            "tax_delta": tax_delta,
            "pollution_delta": max(-0.5, pollution_delta),
            "happiness": min(10.0, happiness),
            "edu_bonus": min(0.5, edu_bonus),
            "jobs_mult": min(0.5, jobs_mult),
            "blocked_types": blocked,
        }

    def to_snapshot(self) -> dict:
        return {
            "next_id": self._next_id,
            "districts": [d.to_dict() for d in self.districts.values()],
        }

    @classmethod
    def from_snapshot(cls, data: dict | None) -> "DistrictManager":
        manager = cls()
        if not data:
            return manager
        manager._next_id = int(data.get("next_id", 1))
        for row in data.get("districts", []):
            district = District.from_dict(row)
            manager.districts[district.did] = district
        return manager

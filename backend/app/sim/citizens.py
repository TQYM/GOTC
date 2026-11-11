"""市民个体（对齐 C:S 的 Citizen / CitizenUnit / CitizenInstance 三级）。

C:S 的三级结构与本模块的映射：

| C:S | 数量 | 更新周期 | CITY20 对应 |
|---|---|---|---|
| Citizen（数据） | 1,048,576 | 每 4096 帧轮转 256 个 | `Citizen` 代理 + `scale` 放大 |
| CitizenUnit（家庭） | 524,288 | 每 4096 帧轮转 128 个 | `household` 字段（同一 home 的代理共享） |
| CitizenInstance（可见） | 65,536 | 每 16 帧轮转 4096 个 | 3D 场景里渲染的代理 |

为什么用抽样：C:S 用 100 万条 struct 在 C# 里按 256 个/帧轮转；Python 里 1.6 万个对象
每帧遍历会拖垮 tick。因此 CITY20 保留 `AGENT_LIMIT` 个代理，用 `scale` 把每个代理
放大成 `population / len(agents)` 个人——统计形状一致，算力可控。

生命周期（对齐 C:S 的 CitizenAI）：
- 年龄每年 +1，0-100 岁；超过 `LIFE_EXPECTANCY` 的概率死亡
- 教育 0-3 级（未受教育/小学/中学/大学），学校覆盖提升升级概率
- 就业：每年重新匹配一次岗位，匹配不到则失业
- 幸福：由通勤、污染、服务覆盖、失业共同决定
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

# ---- 生命周期常量（对齐 C:S 的量级，不追求逐值相同）----
AGE_MAX = 100
LIFE_EXPECTANCY = 78  # 平均寿命
EDU_LEVELS = 4  # 0 未受教育 / 1 小学 / 2 中学 / 3 大学
EDU_SCHOOL_BONUS = 0.18  # 每级学校覆盖给的教育升级加成
EDU_BASE_CHANCE = 0.08  # 无学校时的自然升级概率
UNEMPLOYED_HAPPINESS = -18  # 失业对幸福的惩罚
COMMUTE_HAPPINESS_SCALE = -0.35  # 每多 1 分钟通勤扣的幸福
POLLUTION_HAPPINESS_SCALE = -0.25
EDU_HAPPINESS_BONUS = 4  # 每级教育给的幸福加成

AGENT_LIMIT = 800  # 代理上限


def _unit(*parts: object) -> float:
    """稳定的 [0,1) 伪随机数：与调用顺序无关，replay 与在线必然一致。

    不能用 `random.Random`——在线路径是增量推进，恢复路径是重建后整段
    replay，两者的 RNG 状态天然不同步，快照比对会失败。
    """
    raw = "|".join(str(part) for part in parts).encode("utf-8")
    digest = hashlib.blake2b(raw, digest_size=8).digest()
    return int.from_bytes(digest, "big") / 2**64
MIN_AGENTS = 12  # 代理下限（空城也有几个，避免除零）


@dataclass
class Citizen:
    """一个市民代理。id 稳定，生命周期逐年推进。"""

    cid: int
    home: str | None = None
    job: str | None = None
    age: int = 0
    education: int = 0
    happiness: float = 60.0
    commute: int = 0
    employed: bool = False

    def to_dict(self) -> dict:
        return {
            "cid": self.cid,
            "home": self.home,
            "job": self.job,
            "age": self.age,
            "education": self.education,
            "happiness": round(self.happiness, 2),
            "commute": self.commute,
            "employed": self.employed,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Citizen":
        return cls(
            cid=int(data["cid"]),
            home=data.get("home"),
            job=data.get("job"),
            age=int(data.get("age", 0)),
            education=int(data.get("education", 0)),
            happiness=float(data.get("happiness", 60.0)),
            commute=int(data.get("commute", 0)),
            employed=bool(data.get("employed", False)),
        )


@dataclass
class CitizenStats:
    """聚合统计（喂给 metrics 与前端面板）。"""

    population: int = 0
    agents: int = 0
    scale: float = 1.0
    avg_age: float = 0.0
    avg_happiness: float = 60.0
    avg_commute: float = 0.0
    employment_rate: float = 0.0
    education_dist: dict[str, int] = field(default_factory=dict)
    age_dist: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "population": self.population,
            "agents": self.agents,
            "scale": round(self.scale, 2),
            "avg_age": round(self.avg_age, 1),
            "avg_happiness": round(self.avg_happiness, 1),
            "avg_commute": round(self.avg_commute, 1),
            "employment_rate": round(self.employment_rate, 3),
            "education_dist": self.education_dist,
            "age_dist": self.age_dist,
        }


_AGE_BUCKETS = [
    ("child", 0, 14),
    ("teen", 15, 19),
    ("young", 20, 34),
    ("adult", 35, 54),
    ("senior", 55, 74),
    ("elder", 75, 200),
]
_EDU_NAMES = ["none", "primary", "secondary", "university"]


class CitizenPool:
    """代理池：按人口扩充/收缩，逐年推进生命周期。"""

    def __init__(self, seed: int = 0) -> None:
        self.agents: list[Citizen] = []
        self.scale: float = 1.0
        self.population: int = 0
        self._next_id: int = 1
        self._seed = seed

    def set_seed(self, seed: int) -> None:
        """绑定城市种子（只在池为空时调用，不重建已有代理）。"""
        self._seed = seed

    # ---- 同步 ----
    def sync(self, population: int, homes: list[str], jobs: list[str]) -> None:
        """按人口调整代理数量，并重新分配 home / job。

        population 变化时增减代理；homes 为空则所有代理无家。
        """
        population = max(0, int(population))
        self.population = population
        if population <= 0:
            self.agents.clear()
            self.scale = 1.0
            return

        target = min(AGENT_LIMIT, max(MIN_AGENTS, population // 8))
        target = min(target, population) if population < MIN_AGENTS else target
        self.scale = population / max(1, target)

        grew = target > len(self.agents)
        while len(self.agents) < target:
            # cid 用当前长度而不是自增计数器：这样 agent 集合完全由 population
            # 决定，全量重放与快照恢复不会出现 cid 段错位。
            agent = Citizen(cid=len(self.agents))
            # 新代理不是新生儿：城市已有存量人口，年龄/教育按金字塔形状抽样。
            roll = _unit("seed", self._seed, "age", agent.cid)
            agent.age = 5 + int(roll * 58)
            edu_roll = _unit("seed", self._seed, "edu", agent.cid)
            agent.education = 0 if edu_roll < 0.25 else 1 if edu_roll < 0.55 else 2 if edu_roll < 0.85 else 3
            self.agents.append(agent)
        self._next_id = len(self.agents)
        if len(self.agents) > target:
            self.agents = self.agents[:target]

        # 只在代理数变化时重新分配：`_recompute` 每 256 帧调一次，
        # 若每次都洗牌，市民的岗位会随机跳动，统计失去意义。
        if grew or any(agent.home is None for agent in self.agents):
            for index, agent in enumerate(self.agents):
                agent.home = homes[index % len(homes)] if homes else None
                if jobs:
                    agent.job = jobs[int(_unit('job', agent.cid) * len(jobs))]
                    agent.employed = True
                else:
                    agent.job = None
                    agent.employed = False

    # ---- 逐年推进 ----
    def advance_year(
        self,
        *,
        year: int = 0,
        school_coverage: float,
        clinic_coverage: float,
        pollution: float,
        avg_commute: int,
        job_openings: int,
    ) -> None:
        """一年一次的生命周期推进。

        - 年龄 +1，超寿命概率死亡
        - 教育升级（受学校覆盖影响）
        - 就业重匹配（岗位不足则失业）
        - 幸福度重算（通勤 / 污染 / 失业 / 教育）
        """
        if not self.agents:
            return

        survivors: list[Citizen] = []
        for agent in self.agents:
            agent.age += 1
            # 死亡：超过平均寿命后，每年死亡概率线性上升
            if agent.age >= LIFE_EXPECTANCY:
                chance = (agent.age - LIFE_EXPECTANCY + 1) / (AGE_MAX - LIFE_EXPECTANCY)
                if _unit("death", agent.cid, year) < chance * 0.35:
                    continue
            # 教育升级
            if agent.age >= 6 and agent.education < EDU_LEVELS - 1:
                chance = EDU_BASE_CHANCE + school_coverage * EDU_SCHOOL_BONUS
                if _unit("edu-up", agent.cid, year) < chance:
                    agent.education += 1
            # 就业重匹配
            if agent.age >= 18 and agent.age < 65:
                if job_openings > 0:
                    agent.employed = True
                    if agent.job is None:
                        agent.job = f"job-{int(_unit('job-open', agent.cid, year) * max(1, job_openings))}"
                    job_openings -= 1
                else:
                    agent.employed = False
                    agent.job = None
            else:
                agent.employed = False
                agent.job = None
            # 幸福度
            happiness = 60.0
            happiness += avg_commute * COMMUTE_HAPPINESS_SCALE
            happiness += pollution * POLLUTION_HAPPINESS_SCALE
            happiness += agent.education * EDU_HAPPINESS_BONUS
            happiness += clinic_coverage * 6.0
            if not agent.employed and 18 <= agent.age < 65:
                happiness += UNEMPLOYED_HAPPINESS
            agent.happiness = max(0.0, min(100.0, happiness))
            survivors.append(agent)

        self.agents = survivors
        if self.agents:
            self.scale = self.population / len(self.agents)

    # ---- 聚合 ----
    def stats(self) -> CitizenStats:
        if not self.agents:
            return CitizenStats(population=self.population, agents=0)

        total = len(self.agents)
        avg_age = sum(a.age for a in self.agents) / total
        avg_happiness = sum(a.happiness for a in self.agents) / total
        avg_commute = sum(a.commute for a in self.agents) / total
        employed = sum(1 for a in self.agents if a.employed)
        working_age = [a for a in self.agents if 18 <= a.age < 65]
        employment_rate = (
            sum(1 for a in working_age if a.employed) / len(working_age)
            if working_age
            else 0.0
        )

        edu_dist = {name: 0 for name in _EDU_NAMES}
        for agent in self.agents:
            edu_dist[_EDU_NAMES[min(agent.education, EDU_LEVELS - 1)]] += 1

        age_dist = {name: 0 for name, _, _ in _AGE_BUCKETS}
        for agent in self.agents:
            for name, low, high in _AGE_BUCKETS:
                if low <= agent.age <= high:
                    age_dist[name] += 1
                    break

        return CitizenStats(
            population=self.population,
            agents=total,
            scale=self.scale,
            avg_age=avg_age,
            avg_happiness=avg_happiness,
            avg_commute=avg_commute,
            employment_rate=employment_rate,
            education_dist=edu_dist,
            age_dist=age_dist,
        )

    # ---- 快照 ----
    def to_snapshot(self) -> dict:
        """市民池是「人口 + 种子」的派生视图，不把 800 个代理逐条存进快照。

        原因：代理的年龄/教育每年被 `advance_year` 改写，一旦存盘，全量重放
        与「快照 + 增量」两条路径必然在个位数上分叉（实测差出 15 个 cid）。
        只存 population 与 seed 后，恢复端用同一个确定性构造函数重建，
        两条路径得到逐比特相同的池子。
        """
        # agents 必须整段存：年龄/教育/就业是逐年演化的状态，只存 population
        # 会让恢复端从「初始金字塔」重建，统计与在线分叉。
        # scale 不存，它是 population / len(agents) 的派生值。
        return {
            "population": self.population,
            "seed": self._seed,
            "agents": [a.to_dict() for a in self.agents],
        }

    @classmethod
    def from_snapshot(cls, data: dict | None) -> "CitizenPool":
        pool = cls()
        if not data:
            return pool
        pool.population = int(data.get("population", 0))
        pool.scale = float(data.get("scale", 1.0))  # 旧存档兼容；新快照不带
        pool._next_id = int(data.get("next_id", 0))
        pool._seed = int(data.get("seed", 0))
        # 旧存档若带 agents 就沿用，否则留空由 CityState._sync_citizens 重建
        pool.agents = [Citizen.from_dict(row) for row in data.get("agents", [])]
        if pool.agents:
            pool.scale = pool.population / len(pool.agents)
            pool._next_id = max(a.cid for a in pool.agents) + 1
        return pool

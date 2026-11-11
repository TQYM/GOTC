"""市民个体模型（C:S 三级结构的 CITY20 版）。"""

from app.sim.citizens import AGENT_LIMIT, CitizenPool


def test_pool_scales_with_population():
    pool = CitizenPool(seed=1)
    pool.sync(16000, [f"home-{i}" for i in range(7)], [f"job-{i}" for i in range(5)])
    assert len(pool.agents) <= AGENT_LIMIT
    assert pool.scale > 1.0
    stats = pool.stats()
    assert stats.population == 16000
    assert stats.agents == len(pool.agents)
    assert stats.employment_rate > 0


def test_empty_pool_is_safe():
    pool = CitizenPool(seed=1)
    pool.sync(0, [], [])
    stats = pool.stats()
    assert stats.population == 0
    assert stats.agents == 0
    pool.advance_year(
        school_coverage=0.0,
        clinic_coverage=0.0,
        pollution=0.0,
        avg_commute=0,
        job_openings=0,
    )


def test_aging_and_education_progress():
    pool = CitizenPool(seed=2)
    pool.sync(120, [f"home-{i}" for i in range(3)], [f"job-{i}" for i in range(3)])
    before = sum(a.education for a in pool.agents)
    for _ in range(20):
        pool.advance_year(
            school_coverage=1.0,
            clinic_coverage=1.0,
            pollution=0.0,
            avg_commute=10,
            job_openings=999,
        )
    after = sum(a.education for a in pool.agents)
    assert after > before
    assert all(a.age > 0 for a in pool.agents if a.age > 0)


def test_happiness_drops_with_long_commute():
    short = CitizenPool(seed=3)
    short.sync(200, ["h0"], ["j0"])
    short.advance_year(
        school_coverage=0.5, clinic_coverage=0.5, pollution=0.0,
        avg_commute=10, job_openings=999,
    )
    long = CitizenPool(seed=3)
    long.sync(200, ["h0"], ["j0"])
    long.advance_year(
        school_coverage=0.5, clinic_coverage=0.5, pollution=0.0,
        avg_commute=90, job_openings=999,
    )
    assert long.stats().avg_happiness < short.stats().avg_happiness


def test_snapshot_round_trip():
    """市民池是派生视图：快照存 population + seed，恢复后重建出的池子必须一致。"""
    pool = CitizenPool(seed=4)
    pool.sync(800, ["h0", "h1"], ["j0"])
    data = pool.to_snapshot()
    restored = CitizenPool.from_snapshot(data)
    assert restored.population == pool.population
    assert restored._seed == pool._seed
    assert len(restored.agents) == len(pool.agents)
    assert [a.cid for a in restored.agents] == [a.cid for a in pool.agents]
    assert [a.age for a in restored.agents] == [a.age for a in pool.agents]

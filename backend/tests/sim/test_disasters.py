"""灾难：消防覆盖降低火灾概率，且结果必须可复现（seed + year 决定）。"""

from app.sim.disasters import DISASTER_LABELS, roll_disaster

CANDIDATES = [f"tile-{i}" for i in range(20)]


def test_no_candidates_returns_none():
    assert roll_disaster(1, 1, fire_coverage=0.0, river_near=True, candidates=[], density=1.0) is None


def test_deterministic_for_same_seed_and_year():
    first = roll_disaster(42, 7, fire_coverage=0.0, river_near=False, candidates=CANDIDATES, density=0.2)
    second = roll_disaster(42, 7, fire_coverage=0.0, river_near=False, candidates=CANDIDATES, density=0.2)
    assert first == second


def test_high_fire_coverage_reduces_fire_frequency():
    def fires(coverage: float) -> int:
        return sum(
            1
            for year in range(1, 401)
            if (result := roll_disaster(
                99, year, fire_coverage=coverage, river_near=False,
                candidates=CANDIDATES, density=0.3,
            )) is not None and result.kind == "fire"
        )

    assert fires(0.95) < fires(0.0)


def test_meteor_is_rare():
    meteors = sum(
        1
        for year in range(1, 2001)
        if (result := roll_disaster(
            7, year, fire_coverage=1.0, river_near=False,
            candidates=CANDIDATES, density=0.0,
        )) is not None and result.kind == "meteor"
    )
    assert meteors <= 10


def test_flood_only_when_river_near():
    without_river = [
        roll_disaster(5, year, fire_coverage=1.0, river_near=False, candidates=CANDIDATES, density=0.0)
        for year in range(1, 201)
    ]
    assert all(result is None or result.kind != "flood" for result in without_river)


def test_labels_cover_all_kinds():
    assert set(DISASTER_LABELS) == {"fire", "flood", "meteor"}

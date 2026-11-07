"""幸福度（03 §4.10）：基准 50 + 七类修正，截断 [0,100]。"""

BASE = 50
GREEN_WEIGHT = 30
POLLUTION_WEIGHT = 40
LAND_WEIGHT = 0.2
LAND_CAP = 10
COVERAGE_WEIGHT = 6
CROWDING_PENALTY = 6
CROWDING_SHARE_THRESHOLD = 0.4  # res_high 座数占比（03 未定量「占比」口径，PR-08 取座数）


def commute_modifier(avg_commute: int) -> int:
    if avg_commute < 20:
        return 15
    if avg_commute < 40:
        return 10
    if avg_commute < 60:
        return 0
    if avg_commute <= 80:
        return -8
    return -15


def job_ratio_modifier(ratio: float) -> int:
    if 0.85 <= ratio <= 1.15:
        return 8
    if 1.15 < ratio <= 1.5 or 0.6 <= ratio < 0.85:
        return 0
    return -8


def compute_happiness(
    *,
    green_ratio: float,
    avg_commute: int,
    job_res_ratio: float,
    pollution: float,
    land_price_index: float,
    coverage_edu: float,
    coverage_med: float,
    res_high_share: float,
    event_delta: float = 0.0,
) -> int:
    land_mod = max(-LAND_CAP, min(LAND_CAP, (land_price_index - 100) * LAND_WEIGHT))
    value = (
        BASE
        + GREEN_WEIGHT * green_ratio
        + commute_modifier(avg_commute)
        + job_ratio_modifier(job_res_ratio)
        - POLLUTION_WEIGHT * pollution
        + land_mod
        + COVERAGE_WEIGHT * (coverage_edu + coverage_med)
        + (event_delta)
    )
    if res_high_share > CROWDING_SHARE_THRESHOLD:
        value -= CROWDING_PENALTY
    return max(0, min(100, round(value)))

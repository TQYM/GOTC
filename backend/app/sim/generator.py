"""世界生成（03 §2）：seed 确定性的 48×48 地块生成。

流程（顺序固定，保证可复现）：
1. 基底 flat → 2. 河道随机游走 → 3. 河岸 → 4. 丘陵团簇 →
5. 林地（贴水贴山）→ 6. 省道斜穿 → 7. 可建设率校验（失败重生成）→ 8. 简报。

冲突优先级（03 §2）：river > bank > inherited_road > hill > forest > flat。
确定性（03 §1）：所有随机来自 ``random.Random(f"city20:{seed}:{attempt}")``，
相同 seed ⇒ 相同地块，与平台/运行次数无关。

比例目标（01 §2，均可调）：丘陵/林地生成后按目标区间补齐或修剪（由同一
rng 驱动，保持确定性）；河岸按"两侧各 1 格"（每行 2 格）忠实实现，
实测约 4–4.5%，低于 01 §2 的 6–9% 目标，属已知偏差（PR 说明）。
"""

import random

from app.config import GenerationConfig, SimConfig, load_sim_config
from app.contracts.parcel import Parcel, ParcelConstraints, Terrain

# 冲突优先级（数字大者胜，03 §2）
_PRIORITY = {
    Terrain.RIVER: 60,
    Terrain.BANK: 50,
    Terrain.ROAD_INHERITED: 40,
    Terrain.HILL: 30,
    Terrain.FOREST: 20,
    Terrain.FLAT: 10,
}


def _can_overwrite(existing: Terrain, new: Terrain) -> bool:
    return _PRIORITY[new] > _PRIORITY[existing]


def _stamp_river(
    terrain: list[list[Terrain]], rng: random.Random, gen: GenerationConfig
) -> list[tuple[int, int]]:
    """步骤 2：北边界随机一点入、南边界出，随机游走成 2–3 格宽河道带。"""
    size = len(terrain)
    river: list[tuple[int, int]] = []
    col = rng.randint(3, size - 4)
    for row in range(size):
        width = gen.river_width_max if rng.random() < 0.25 else gen.river_width_min
        col = max(0, min(size - width, col))
        for c in range(col, col + width):
            if terrain[row][c] is Terrain.FLAT:
                terrain[row][c] = Terrain.RIVER
                river.append((row, c))
        # 60% 直行 / 各 20% 左右
        roll = rng.random()
        if roll < 0.20:
            col -= 1
        elif roll < 0.40:
            col += 1
    return river


def _stamp_bank(terrain: list[list[Terrain]], river: list[tuple[int, int]]) -> None:
    """步骤 3：河道两侧各 1 格标记 bank（只覆盖 flat，01 §2）。"""
    size = len(terrain)
    for r, c in river:
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < size and 0 <= nc < size and terrain[nr][nc] is Terrain.FLAT:
                terrain[nr][nc] = Terrain.BANK


def _hill_cluster(
    terrain: list[list[Terrain]], rng: random.Random, gen: GenerationConfig
) -> list[tuple[int, int]]:
    """单个丘陵团簇：椭圆 + 噪声边缘（03 §2 步骤 4）。"""
    size = len(terrain)
    r1 = rng.uniform(*gen.hill_radius)
    r2 = rng.uniform(*gen.hill_radius)
    center_r = rng.randint(int(r1) + 1, size - int(r1) - 2)
    center_c = rng.randint(int(r2) + 1, size - int(r2) - 2)
    cells: list[tuple[int, int]] = []
    for r in range(center_r - int(r1) - 1, center_r + int(r1) + 2):
        for c in range(center_c - int(r2) - 1, center_c + int(r2) + 2):
            if not (0 <= r < size and 0 <= c < size):
                continue
            dr, dc = (r - center_r) / r1, (c - center_c) / r2
            jitter = (rng.random() - 0.5) * 0.4
            if dr * dr + dc * dc <= 1.0 + jitter and _can_overwrite(
                terrain[r][c], Terrain.HILL
            ):
                terrain[r][c] = Terrain.HILL
                cells.append((r, c))
    return cells


def _fit_feature(
    terrain: list[list[Terrain]],
    rng: random.Random,
    cells: list[tuple[int, int]],
    target_pct: tuple[float, float],
    total: int,
    add_one,
    terrain_value: Terrain,
    max_extra: int = 12,
) -> list[tuple[int, int]]:
    """把特征比例补齐/修剪进目标区间（同一 rng 驱动，保持确定性）。"""
    lo, hi = target_pct

    def _pct() -> float:
        return len(cells) / total

    extra = 0
    tries = 0
    max_tries = max_extra * 3
    while _pct() < lo and extra < max_extra and tries < max_tries:
        added = add_one()
        cells.extend(added)
        extra += 1 if added else 0  # 簇完全被既有特征挡住时不消耗预算，换中心重试
        tries += 1
    while _pct() > hi and cells:
        r, c = cells.pop()  # 逆生成顺序修剪（新簇先整簇移除）
        if terrain[r][c] is terrain_value:
            terrain[r][c] = Terrain.FLAT
    return cells


def _stamp_hills(
    terrain: list[list[Terrain]], rng: random.Random, gen: GenerationConfig
) -> list[tuple[int, int]]:
    """步骤 4：丘陵团簇 + 比例拟合（目标 8–12%）。"""
    total = len(terrain) * len(terrain)
    clusters = rng.randint(*gen.hill_clusters)
    cells: list[tuple[int, int]] = []
    for _ in range(clusters):
        cells.extend(_hill_cluster(terrain, rng, gen))
    return _fit_feature(
        terrain, rng, cells, gen.hill_target_pct, total,
        lambda: _hill_cluster(terrain, rng, gen), Terrain.HILL,
    )


def _forest_patch(
    terrain: list[list[Terrain]],
    rng: random.Random,
    gen: GenerationConfig,
    edge_cells: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """单片林地：forest_edge_bias 概率贴河岸/丘陵边缘（03 §2 步骤 5）。"""
    size = len(terrain)
    radius = rng.uniform(*gen.forest_radius)
    if edge_cells and rng.random() < gen.forest_edge_bias:
        er, ec = edge_cells[rng.randint(0, len(edge_cells) - 1)]
        center_r = max(1, min(size - 2, er + rng.randint(-2, 2)))
        center_c = max(1, min(size - 2, ec + rng.randint(-2, 2)))
    else:
        center_r = rng.randint(2, size - 3)
        center_c = rng.randint(2, size - 3)
    cells: list[tuple[int, int]] = []
    for r in range(center_r - int(radius) - 1, center_r + int(radius) + 2):
        for c in range(center_c - int(radius) - 1, center_c + int(radius) + 2):
            if not (0 <= r < size and 0 <= c < size):
                continue
            dr, dc = (r - center_r) / radius, (c - center_c) / radius
            if dr * dr + dc * dc <= 1.0 and _can_overwrite(terrain[r][c], Terrain.FOREST):
                terrain[r][c] = Terrain.FOREST
                cells.append((r, c))
    return cells


def _stamp_forest(
    terrain: list[list[Terrain]],
    rng: random.Random,
    gen: GenerationConfig,
) -> list[tuple[int, int]]:
    """步骤 5：林地片 + 比例拟合（目标 5–8%），贴水贴山。"""
    size = len(terrain)
    total = size * size
    edges = [
        (r, c)
        for r in range(size)
        for c in range(size)
        if terrain[r][c] in (Terrain.BANK, Terrain.HILL)
    ]
    patches = rng.randint(*gen.forest_patches)
    cells: list[tuple[int, int]] = []
    for _ in range(patches):
        cells.extend(_forest_patch(terrain, rng, gen, edges))
    return _fit_feature(
        terrain, rng, cells, gen.forest_target_pct, total,
        lambda: _forest_patch(terrain, rng, gen, edges), Terrain.FOREST,
    )


def _stamp_road(terrain: list[list[Terrain]], rng: random.Random) -> list[list[int]]:
    """步骤 6：西北角入、东南角出，45° 斜穿，每 6–8 格允许一次小偏移，宽 1。"""
    size = len(terrain)
    road: list[list[int]] = []
    offset = 0
    steps_since_drift = 0
    drift_at = rng.randint(6, 8)
    for k in range(size):
        if steps_since_drift >= drift_at:
            offset += rng.choice([-1, 0, 1])
            offset = max(-3, min(3, offset))
            steps_since_drift = 0
            drift_at = rng.randint(6, 8)
        col = max(0, min(size - 1, k + offset))
        if _can_overwrite(terrain[k][col], Terrain.ROAD_INHERITED):
            terrain[k][col] = Terrain.ROAD_INHERITED
            road.append([k, col])
        steps_since_drift += 1
    return road


def _buildable_ratio(terrain: list[list[Terrain]]) -> float:
    buildable = sum(1 for row in terrain for t in row if t in (Terrain.FLAT, Terrain.HILL))
    total = sum(len(row) for row in terrain)
    return buildable / total


def _try_generate(
    seed: int, attempt: int, config: SimConfig
) -> tuple[list[list[Terrain]], list[list[int]], float]:
    """单次生成尝试（确定性：随机源由 seed+attempt 派生）。"""
    rng = random.Random(f"city20:{seed}:{attempt}")
    size = config.grid_size
    gen = config.generation
    terrain = [[Terrain.FLAT] * size for _ in range(size)]
    river = _stamp_river(terrain, rng, gen)
    _stamp_bank(terrain, river)
    _stamp_hills(terrain, rng, gen)
    _stamp_forest(terrain, rng, gen)
    road = _stamp_road(terrain, rng)
    return terrain, road, _buildable_ratio(terrain)


def generate_parcel(seed: int, config: SimConfig | None = None) -> Parcel:
    """生成一局游戏的完整地块（03 §2）。

    可建设率不达标则换新随机源重生成（步骤 7，最多 max_regen_attempts 次，
    兜底取历次尝试中可建设率最高的一次——放宽比例兜底）。
    """
    cfg = config or load_sim_config()
    gen = cfg.generation

    best: tuple[list[list[Terrain]], list[list[int]], float] | None = None
    for attempt in range(1, gen.max_regen_attempts + 1):
        terrain, road, buildable = _try_generate(seed, attempt, cfg)
        if best is None or buildable > best[2]:
            best = (terrain, road, buildable)
        if buildable >= gen.buildable_ratio_min:
            break
    assert best is not None
    terrain, road, buildable = best

    # 步骤 8：约束 + 简报（模板文案；AI 版随 PR-10 叙述层接入）
    rng = random.Random(f"city20:{seed}:constraints")
    height_limit = rng.randint(*gen.height_limit_m)
    constraints = ParcelConstraints(
        height_limit_m=height_limit,
        green_line_m=gen.green_line_m,
        buildable_ratio=round(buildable, 2),
        briefing=cfg.briefing_template.format(
            height_limit_m=height_limit,
            green_line_m=gen.green_line_m,
            buildable_pct=round(buildable * 100),
        ),
    )
    return Parcel(
        size=cfg.grid_size,
        cell_size_m=cfg.cell_size_m,
        terrain=terrain,
        inherited_road=road,
        constraints=constraints,
        seed=seed,
    )

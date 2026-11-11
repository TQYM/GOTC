"""长跑模型体检：20 年，每年采样关键指标，找异常（NaN/爆炸/卡死/不可达）。"""

import asyncio
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.config import Settings, load_sim_config
from app.core.repository import SaveRepository
from app.core.service import SaveService
from app.contracts.tile import TileType


async def main() -> None:
    tmp = Path(tempfile.mkdtemp())
    settings = Settings(
        database_path=str(tmp / "city20.db"),
        parcel_data_dir=str(tmp / "parcels"),
        llm_api_key=None,
    )
    repo = SaveRepository(settings.database_path)
    await repo.initialize()
    svc = SaveService(repo, config=load_sim_config(), settings=settings)
    from app.contracts.save import CreateSaveRequest
    created = await svc.create(CreateSaveRequest(seed=882314, parcel_id="sandbox", name="体检城"))
    code = created.city_code
    await svc.start(code)

    # 12×12 住宅 + 4×4 商业 + 4×4 工业，尽量铺开
    await svc.apply(code, "zone", client_op_id="z1",
                    payload={"type": "res_low", "anchor": [8, 8], "rows": 12, "cols": 12})
    await svc.apply(code, "zone", client_op_id="z2",
                    payload={"type": "com_shop", "anchor": [22, 8], "rows": 4, "cols": 4})
    await svc.apply(code, "zone", client_op_id="z3",
                    payload={"type": "ind_light", "anchor": [8, 22], "rows": 4, "cols": 4})

    runtime = await svc._runtime(code)
    state = runtime.state
    print(f"tiles={len(state.tiles)} funds={state.funds}")
    for year in range(1, 21):
        state.advance(3600)
        m = state.metrics
        print(
            f"Y{year:>2} pop={m.population:>6} jobs={m.jobs:>5} "
            f"builds={state.builds_total:>4} funds={state.funds:>12} "
            f"happy={m.happiness:>3} cong={m.congestion:.3f} "
            f"commute={m.avg_commute:>3} poll={m.pollution:.2f} "
            f"tax={m.tax_income:>9} upkeep={m.upkeep:>7} "
            f"R/C/W={state.demand.to_ui(state.demand.actual_residential):>3}/"
            f"{state.demand.to_ui(state.demand.actual_commercial):>3}/"
            f"{state.demand.to_ui(state.demand.actual_workplace):>3}"
        )
    print("types:", json.dumps({t.type.value: 1 for t in state.tiles.values()}, ensure_ascii=False)[:80])
    print("citizens:", state.citizens.stats().to_dict())
    print("budget debt:", state.budget.total_debt(), "loans:", len(state.budget.loans))


asyncio.run(main())

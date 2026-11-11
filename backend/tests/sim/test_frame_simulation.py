"""帧制模拟的结构验证：一年 = 3600 帧、闸门限速、需求双轨。"""

import asyncio

from app.config import Settings, load_sim_config
from app.contracts.save import CreateSaveRequest
from app.core.repository import SaveRepository
from app.core.service import SaveService


def _first_flat(state) -> list[int]:
    for row_index, row in enumerate(state.parcel.terrain):
        for col_index, terrain in enumerate(row):
            if terrain.value == "flat":
                return [row_index, col_index]
    raise AssertionError("no flat")


def test_advance_year_runs_frames_and_builds(tmp_path):
    async def scenario():
        settings = Settings(
            database_path=str(tmp_path / "city20.db"),
            parcel_data_dir=str(tmp_path / "parcels"),
            llm_api_key=None,
        )
        service = SaveService(
            SaveRepository(settings.database_path),
            config=load_sim_config(),
            settings=settings,
        )
        await service.initialize()
        created = await service.create(
            CreateSaveRequest(seed=882314, parcel_id="sandbox")
        )
        code = created.city_code
        await service.start(code)
        runtime = await service._runtime(code)
        anchor = _first_flat(runtime.state)

        await service.apply(
            code, "place", client_op_id="op-000",
            payload={"type": "res_mid", "anchor": anchor},
        )
        await service.apply(code, "advance", client_op_id="op-001", payload={})

        state = (await service._runtime(code)).state
        # 一年 = 3600 帧，年度结算推进到第 2 年
        assert state.clock.frame == state.clock.frames_per_year
        assert state.at_year == 2
        assert state.years_settled == 1
        # 闸门 8 帧一次，一年最多 450 次放行
        assert 0 < state.builds_total <= state.clock.frames_per_year // 8
        # 需求双轨都在动
        assert state.demand.displayed_residential != 0.0 or state.demand.actual_residential != 0.0
        await service.close()

    asyncio.run(scenario())


def test_advance_frames_is_partial_year(tmp_path):
    async def scenario():
        settings = Settings(
            database_path=str(tmp_path / "city20.db"),
            parcel_data_dir=str(tmp_path / "parcels"),
            llm_api_key=None,
        )
        service = SaveService(
            SaveRepository(settings.database_path),
            config=load_sim_config(),
            settings=settings,
        )
        await service.initialize()
        created = await service.create(
            CreateSaveRequest(seed=882314, parcel_id="sandbox")
        )
        code = created.city_code
        await service.start(code)
        runtime = await service._runtime(code)
        anchor = _first_flat(runtime.state)
        await service.apply(
            code, "place", client_op_id="op-000",
            payload={"type": "res_mid", "anchor": anchor},
        )

        # 直接驱动状态层推进 100 帧
        runtime = await service._runtime(code)
        runtime.state.advance(100)
        assert runtime.state.clock.frame == 100
        assert runtime.state.at_year == 1
        await service.close()

    asyncio.run(scenario())

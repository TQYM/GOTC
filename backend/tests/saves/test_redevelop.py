"""PR-29：真实现状资产、整栋更新、惩罚期限与持久化。"""

import asyncio
from pathlib import Path

import pytest

from app.config import Settings, load_sim_config
from app.contracts.errors import ErrorCode
from app.contracts.save import CreateSaveRequest
from app.core.errors import GameError
from app.core.repository import SaveRepository
from app.core.service import SaveService

ROOT = Path(__file__).resolve().parents[3]


def make_service(tmp_path) -> SaveService:
    settings = Settings(
        database_path=str(tmp_path / "city20.db"),
        parcel_data_dir=str(ROOT / "data" / "parcels"),
        llm_api_key=None,
    )
    return SaveService(
        SaveRepository(settings.database_path),
        config=load_sim_config(),
        settings=settings,
    )


def selectable_asset(runtime):
    assets = runtime.state.existing_assets
    candidates = []
    for asset in assets.values():
        if asset.demolition_cost > runtime.state.funds or len(asset.cells) < 2:
            continue
        if not (asset.population or asset.jobs):
            continue
        others = {
            tuple(cell)
            for other_id, other in assets.items()
            if other_id != asset.asset_id
            for cell in other.cells
        }
        if any(tuple(cell) in others for cell in asset.cells):
            continue
        candidates.append(asset)
    assert candidates, "真实包必须有可负担、无遮挡的多格更新资产"
    return min(candidates, key=lambda asset: asset.demolition_cost)


def test_real_parcel_redevelop_place_penalty_and_restart(tmp_path):
    async def scenario():
        service = make_service(tmp_path)
        await service.initialize()
        created = await service.create(CreateSaveRequest())
        assert created.parcel.parcel_id == "beijing_cbd"
        assert created.metrics.population == 7811
        assert created.metrics.jobs == 61046
        assert created.metrics.upkeep == 9834946
        code = created.city_code
        await service.start(code)
        runtime = await service._runtime(code)
        asset = selectable_asset(runtime)
        anchor = asset.cells[0]

        with pytest.raises(GameError) as occupied:
            await service.apply(
                code, "place", client_op_id="blocked-by-existing",
                payload={"type": "res_low", "anchor": anchor},
            )
        assert occupied.value.code is ErrorCode.INVALID_PLACEMENT
        assert (await service.get(code)).last_seq == 0

        before = (await service.get(code)).metrics
        result = await service.apply(
            code, "redevelop", client_op_id="redevelop-real-1", payload={"anchor": anchor}
        )
        detail = result.redevelopment
        assert detail is not None
        assert detail.asset_id == asset.asset_id
        assert len(detail.cells) >= 2
        assert result.funds_after == before.funds - asset.demolition_cost
        assert result.metrics.population == before.population - asset.population
        assert result.metrics.jobs == before.jobs - asset.jobs
        assert result.metrics.upkeep == before.upkeep - asset.upkeep
        assert result.metrics.happiness == max(0, before.happiness - 5)
        assert detail.penalty_until_year == 4
        assert result.redeveloped_asset_ids == [asset.asset_id]
        assert (await service.get(code)).parcel.terrain[anchor[0]][anchor[1]].value == "flat"

        placed = await service.apply(
            code, "place", client_op_id="new-home-after-redevelop",
            payload={"type": "res_low", "anchor": anchor},
        )
        assert placed.tile is not None
        assert placed.metrics.population == result.metrics.population  # 新住宅仍从 0 入住
        original_redevelop = result

        for index in range(3):
            advanced = await service.apply(
                code, "advance", client_op_id=f"year-after-redevelop-{index}", payload={}
            )
        assert advanced.city_year == 4
        current = await service._runtime(code)
        assert current.state.at_year >= current.state.relocation_penalty_until
        online = await service.get(code)
        await service.close()

        restored = make_service(tmp_path)
        await restored.initialize()
        recovered = await restored.get(code)
        assert recovered.model_dump(mode="json") == online.model_dump(mode="json")
        duplicate = await restored.apply(
            code, "redevelop", client_op_id="redevelop-real-1", payload={"anchor": anchor}
        )
        assert duplicate == original_redevelop
        assert (await restored.get(code)).last_seq == online.last_seq
        await restored.close()

    asyncio.run(scenario())


def test_redevelop_insufficient_funds_and_empty_cell_do_not_write(tmp_path):
    async def scenario():
        service = make_service(tmp_path)
        await service.initialize()
        created = await service.create(CreateSaveRequest())
        await service.start(created.city_code)
        runtime = await service._runtime(created.city_code)
        expensive = min(
            (asset for asset in runtime.state.existing_assets.values()
             if asset.demolition_cost > runtime.state.funds),
            key=lambda asset: asset.demolition_cost,
        )
        with pytest.raises(GameError) as funds:
            await service.apply(
                created.city_code, "redevelop", client_op_id="too-expensive",
                payload={"anchor": expensive.cells[0]},
            )
        assert funds.value.code is ErrorCode.INSUFFICIENT_FUNDS

        flat = next(
            [r, c] for r, row in enumerate(runtime.state.parcel.terrain)
            for c, terrain in enumerate(row) if terrain.value == "flat"
        )
        with pytest.raises(GameError) as missing:
            await service.apply(
                created.city_code, "redevelop", client_op_id="no-asset",
                payload={"anchor": flat},
            )
        assert missing.value.code is ErrorCode.INVALID_PLACEMENT
        state = await service.get(created.city_code)
        assert state.last_seq == 0 and state.redeveloped_asset_ids == []
        await service.close()

    asyncio.run(scenario())


def test_redevelop_penalty_is_read_only_in_projection(tmp_path):
    async def scenario():
        service = make_service(tmp_path)
        await service.initialize()
        created = await service.create(CreateSaveRequest())
        await service.start(created.city_code)
        runtime = await service._runtime(created.city_code)
        asset = selectable_asset(runtime)
        await service.apply(
            created.city_code, "redevelop", client_op_id="project-redevelop",
            payload={"anchor": asset.cells[0]},
        )
        before = await service.get(created.city_code)
        projection = await service.project(created.city_code, 3)
        assert [step.year for step in projection.projection] == [2, 3, 4]
        assert projection.base_seq == before.last_seq == 1
        after = await service.get(created.city_code)
        assert after.model_dump(mode="json") == before.model_dump(mode="json")
        assert runtime.state.at_year == 1
        assert runtime.state.relocation_penalty_until == 4
        await service.close()

    asyncio.run(scenario())

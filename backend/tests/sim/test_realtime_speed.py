"""实时模拟循环：速度档推进、暂停冻结、关闭时取消任务。"""

import asyncio

from app.config import Settings, load_sim_config
from app.contracts.save import CreateSaveRequest
from app.core.repository import SaveRepository
from app.core.service import SaveService


def _service(tmp_path) -> SaveService:
    settings = Settings(
        database_path=str(tmp_path / "city20.db"),
        parcel_data_dir=str(tmp_path / "parcels"),
        llm_api_key=None,
    )
    return SaveService(
        SaveRepository(settings.database_path),
        config=load_sim_config(),
        settings=settings,
    )


def test_speed_advances_and_pause_freezes(tmp_path):
    async def scenario():
        service = _service(tmp_path)
        await service.initialize()
        created = await service.create(CreateSaveRequest(seed=882314, parcel_id="sandbox"))
        code = created.city_code
        await service.start(code)

        await service.set_speed(code, 1)
        await asyncio.sleep(0.5)
        state = (await service._runtime(code)).state
        assert state.clock.frame > 0, "实时循环没有推进帧"

        await service.set_speed(code, 0)
        frozen = state.clock.frame
        await asyncio.sleep(0.2)
        state = (await service._runtime(code)).state
        assert state.clock.frame == frozen, "暂停后帧仍在前进"

        await service.close()

    asyncio.run(scenario())


def test_speed_three_is_four_frames_per_tick(tmp_path):
    async def scenario():
        service = _service(tmp_path)
        await service.initialize()
        created = await service.create(CreateSaveRequest(seed=882314, parcel_id="sandbox"))
        code = created.city_code
        await service.start(code)
        runtime = await service._runtime(code)
        await service.set_speed(code, 3)
        before = runtime.state.clock.frame
        runtime.state.advance(1)  # 手动一个 tick
        assert runtime.state.clock.frame - before == 4
        await service.set_speed(code, 0)
        await service.close()

    asyncio.run(scenario())

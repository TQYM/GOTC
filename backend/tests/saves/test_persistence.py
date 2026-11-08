"""PR-23：200 op 重放、快照增量、重启恢复与幂等。"""

import asyncio
import json

from app.config import Settings, load_sim_config
from app.contracts.save import CreateSaveRequest
from app.core.city import CityState
from app.core.repository import SaveRepository
from app.core.service import SaveService


def make_service(tmp_path, *, snapshot_interval: int = 50) -> SaveService:
    settings = Settings(
        database_path=str(tmp_path / "city20.db"),
        parcel_data_dir=str(tmp_path / "parcels"),
        llm_api_key=None,
    )
    return SaveService(
        SaveRepository(settings.database_path, snapshot_interval=snapshot_interval),
        config=load_sim_config(),
        settings=settings,
    )


def flat_anchor(state) -> list[int]:
    for r, row in enumerate(state.parcel.terrain):
        for c, terrain in enumerate(row):
            if terrain.value == "flat":
                return [r, c]
    raise AssertionError("no flat")


def test_two_hundred_ops_replay_and_snapshot_recovery(tmp_path):
    async def scenario():
        service = make_service(tmp_path)
        await service.initialize()
        created = await service.create(CreateSaveRequest(seed=882314, parcel_id="sandbox"))
        code = created.city_code
        await service.start(code)
        runtime = await service._runtime(code)
        anchor = flat_anchor(runtime.state)
        await service.apply(
            code, "place", client_op_id="op-000",
            payload={"type": "res_mid", "anchor": anchor},
        )
        for index in range(1, 200):
            result = await service.apply(
                code, "advance", client_op_id=f"op-{index:03d}", payload={}
            )
            assert result.seq == index + 1
        online = (await service.get(code)).model_dump(mode="json")
        snapshots = await service.repository.db.execute_fetchall(
            "SELECT seq FROM snapshots ORDER BY seq"
        )
        assert [row["seq"] for row in snapshots] == [0, 50, 100, 150, 200]
        await service.close()

        restored_service = make_service(tmp_path)
        await restored_service.initialize()
        restored = await restored_service.get(code)
        assert restored.model_dump(mode="json") == online

        # 最近快照 + 增量 == 从 seq=0 全量重放。
        initial_rows = await restored_service.repository.db.execute_fetchall(
            "SELECT state_json FROM snapshots WHERE seq=0"
        )
        op_rows = await restored_service.repository.db.execute_fetchall(
            "SELECT * FROM ops ORDER BY seq"
        )
        full = CityState.from_snapshot(json.loads(initial_rows[0]["state_json"]))
        full.start_planning()
        for row in op_rows:
            restored_service._apply_domain(
                full, row["op_type"], json.loads(row["payload_json"]), row["seq"]
            )
            full.seq = row["seq"]
        assert full.to_snapshot() == (await restored_service._runtime(code)).state.to_snapshot()
        await restored_service.close()

    asyncio.run(scenario())


def test_restart_idempotency_returns_original_result(tmp_path):
    async def scenario():
        service = make_service(tmp_path)
        await service.initialize()
        created = await service.create(CreateSaveRequest(seed=42, parcel_id="sandbox"))
        await service.start(created.city_code)
        runtime = await service._runtime(created.city_code)
        payload = {"type": "green_park", "anchor": flat_anchor(runtime.state)}
        first = await service.apply(
            created.city_code, "place", client_op_id="same-retry", payload=payload
        )
        await service.close()

        restored = make_service(tmp_path)
        await restored.initialize()
        second = await restored.apply(
            created.city_code, "place", client_op_id="same-retry", payload=payload
        )
        assert second == first
        state = await restored.get(created.city_code)
        assert state.last_seq == 1
        assert len(state.tiles) == 1
        await restored.close()

    asyncio.run(scenario())


def test_concurrent_fifty_advances_are_serialized_and_restored(tmp_path):
    async def scenario():
        service = make_service(tmp_path)
        await service.initialize()
        created = await service.create(CreateSaveRequest(seed=7, parcel_id="sandbox"))
        await service.start(created.city_code)
        results = await asyncio.gather(
            *(
                service.apply(
                    created.city_code,
                    "advance",
                    client_op_id=f"device-{index % 2}-op-{index}",
                    payload={},
                )
                for index in range(50)
            )
        )
        assert sorted(result.seq for result in results) == list(range(1, 51))
        state = await service.get(created.city_code)
        assert state.last_seq == 50
        assert state.city_year == 51
        await service.close()

        restored = make_service(tmp_path)
        await restored.initialize()
        recovered = await restored.get(created.city_code)
        assert recovered.last_seq == 50
        assert recovered.city_year == 51
        await restored.close()

    asyncio.run(scenario())

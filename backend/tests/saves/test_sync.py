"""PR-24：提交后广播、双客户端、断点补发、快照与导师触发。"""

import asyncio
import json

from app.api import saves as saves_api
from app.config import Settings, load_sim_config
from app.contracts.save import CreateSaveRequest
from app.core.broadcaster import Broadcaster
from app.core.repository import SaveRepository
from app.core.service import SaveService


class _LLM:
    available = False


class CountingNarrator:
    def __init__(self):
        self.llm = _LLM()
        self.mentor_calls = 0
        self.news_calls = 0

    async def mentor_comment(self, state, force=False):
        self.mentor_calls += 1
        return {"comment": "test", "force": force}

    async def after_operation(self, *args):
        self.news_calls += 1


def make_service(tmp_path, narrator=None) -> SaveService:
    settings = Settings(
        database_path=str(tmp_path / "city20.db"),
        parcel_data_dir=str(tmp_path / "parcels"),
        llm_api_key=None,
    )
    return SaveService(
        SaveRepository(settings.database_path),
        config=load_sim_config(),
        settings=settings,
        narrator=narrator,
    )


async def started(service: SaveService):
    created = await service.create(CreateSaveRequest(seed=882314, parcel_id="sandbox"))
    await service.start(created.city_code)
    runtime = await service._runtime(created.city_code)
    return created.city_code, runtime


def flat_anchor(runtime) -> list[int]:
    for r, row in enumerate(runtime.state.parcel.terrain):
        for c, terrain in enumerate(row):
            if terrain.value == "flat":
                return [r, c]
    raise AssertionError("no flat")


def place(service, code, anchor, op_id="web-1"):
    return service.apply(
        code, "place", client_op_id=op_id,
        payload={"type": "res_mid", "anchor": anchor},
    )


def test_commit_precedes_broadcast_and_duplicate_is_silent(tmp_path):
    async def scenario():
        narrator = CountingNarrator()
        service = make_service(tmp_path, narrator)
        await service.initialize()
        code, runtime = await started(service)
        first_client = runtime.broadcaster.subscribe()
        second_client = runtime.broadcaster.subscribe()
        result = await place(service, code, flat_anchor(runtime))
        first_event = await first_client.get()
        second_event = await second_client.get()
        assert first_event.id == second_event.id
        assert first_event.event == second_event.event == "op_applied"
        assert first_event.data["seq"] == result.seq == 1
        row = await service.repository.get_operation(runtime.record["save_id"], "web-1")
        assert row is not None and row["seq"] == 1  # 收到事件时已经可独立读到提交

        duplicate = await place(service, code, flat_anchor(runtime))
        assert duplicate == result
        for queue in (first_client, second_client):
            try:
                await asyncio.wait_for(queue.get(), timeout=0.02)
            except TimeoutError:
                pass
            else:
                raise AssertionError("重复 client_op_id 不应二次广播")
        await service.close()

    asyncio.run(scenario())


def test_advance_emits_operation_and_city_year(tmp_path):
    async def scenario():
        service = make_service(tmp_path, CountingNarrator())
        await service.initialize()
        code, runtime = await started(service)
        queue = runtime.broadcaster.subscribe()
        result = await service.apply(code, "advance", client_op_id="year-2", payload={})
        operation = await queue.get()
        year = await queue.get()
        assert operation.event == "op_applied"
        assert year.event == "city_year"
        assert operation.data["seq"] == year.data["seq"] == result.seq
        assert year.data["city_year"] == 2
        await service.close()

    asyncio.run(scenario())


def test_last_event_id_replay_and_overflow_snapshot(tmp_path, monkeypatch):
    async def scenario():
        service = make_service(tmp_path, CountingNarrator())
        await service.initialize()
        code, runtime = await started(service)
        last_id = runtime.broadcaster.latest_id
        result = await place(service, code, flat_anchor(runtime))
        stream = saves_api._event_stream(runtime, service, last_id)
        replayed = await anext(stream)
        assert replayed["event"] == "op_applied"
        assert json.loads(replayed["data"])["seq"] == result.seq
        await stream.aclose()

        runtime.broadcaster = Broadcaster(capacity=2, start_id=0)
        runtime.state.broadcaster = runtime.broadcaster
        for index in range(3):
            runtime.broadcaster.publish("op_applied", {"seq": index})
        overflow = saves_api._event_stream(runtime, service, 0)
        frame = await anext(overflow)
        assert frame["event"] == "snapshot"
        assert frame["id"] == "3"
        assert json.loads(frame["data"])["last_seq"] == result.seq
        await overflow.aclose()
        assert runtime.broadcaster.subscriber_count == 0

        # 心跳只发送注释，不伪造 op，也不改变城市状态。
        monkeypatch.setattr(saves_api, "SSE_HEARTBEAT_SEC", 0.01)
        heartbeat = saves_api._event_stream(runtime, service, runtime.broadcaster.latest_id)
        frame = await anext(heartbeat)
        assert frame == {"comment": "heartbeat"}
        await heartbeat.aclose()
        await service.close()

    asyncio.run(scenario())


def test_new_connection_gets_snapshot_and_live_events_after_cutoff(tmp_path):
    async def scenario():
        service = make_service(tmp_path, CountingNarrator())
        await service.initialize()
        code, runtime = await started(service)
        stream = saves_api._event_stream(runtime, service, None)
        snapshot = await anext(stream)
        assert snapshot["event"] == "snapshot"
        assert json.loads(snapshot["data"])["city_code"] == code
        cutoff = int(snapshot["id"])
        result = await place(service, code, flat_anchor(runtime))
        live = await anext(stream)
        assert int(live["id"]) > cutoff
        assert live["event"] == "op_applied"
        assert json.loads(live["data"])["seq"] == result.seq
        await stream.aclose()
        await service.close()

    asyncio.run(scenario())


def test_projection_and_report_events_do_not_change_seq(tmp_path):
    async def scenario():
        service = make_service(tmp_path, CountingNarrator())
        await service.initialize()
        code, runtime = await started(service)
        queue = runtime.broadcaster.subscribe()
        projection = await service.project(code, 2)
        steps = [await queue.get(), await queue.get()]
        assert [entry.event for entry in steps] == ["projection_step", "projection_step"]
        assert [entry.data["year"] for entry in steps] == [2, 3]
        assert all(entry.data["projection_id"] == projection.projection_id for entry in steps)
        report = await service.report(code)
        ready = await queue.get()
        assert ready.event == "report_ready"
        assert ready.data["report_id"] == report.report_id
        assert (await service.get(code)).last_seq == 0
        await service.close()

    asyncio.run(scenario())


def test_mentor_uses_newcomer_then_regular_operation_cadence(tmp_path):
    async def scenario():
        narrator = CountingNarrator()
        service = make_service(tmp_path, narrator)
        await service.initialize()
        code, _runtime = await started(service)
        expected = 0
        for index in range(1, 31):
            await service.apply(
                code, "advance", client_op_id=f"year-{index}", payload={}
            )
            await asyncio.sleep(0)
            if index in {5, 10, 15, 20, 30}:
                expected += 1
            assert narrator.mentor_calls == expected
        await service.project(code, 1)
        assert narrator.mentor_calls == 5  # 只读推演不占领域 op seq
        await service.mentor(code)
        await asyncio.sleep(0)
        assert narrator.mentor_calls == 6
        assert narrator.news_calls == 30
        await service.close()

    asyncio.run(scenario())

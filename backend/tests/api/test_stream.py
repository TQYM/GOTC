"""SSE 流与推演播放测试（PR-13 DoD：断点补发/溢出快照/心跳/真 timer 事件/播放）。"""

import asyncio
import json

import httpx

from app.api.playback import run_playback
from app.api.stream import _event_stream
from app.config import Settings
from app.contracts.metrics import MetricsDiff, Phase
from app.contracts.tile import TileType
from app.core.session import GameSession
from app.core.timer import start_heartbeat
from tests.narrate.test_news import make_narrator
from tests.sim.test_livability import CONFIG, make_parcel


def make_session(sid="s0"):
    return GameSession(sid, parcel=make_parcel(), config=CONFIG)


async def collect_frames(gen, count, timeout=1.0):
    frames = []
    async with asyncio.timeout(timeout):
        for _ in range(count):
            frames.append(await anext(gen))
    return frames


class TestSnapshot:
    def test_fresh_connect_gets_phase_change_and_full_tick(self):
        async def scenario():
            session = make_session("s1")
            gen = _event_stream(session, None)
            frames = await collect_frames(gen, 2)
            assert [f["event"] for f in frames] == ["phase_change", "tick"]
            tick = json.loads(frames[1]["data"])
            MetricsDiff.model_validate(tick)  # 契约形状
            assert tick["delta"] == {}
            assert tick["after"]["funds"] == session.funds
            await gen.aclose()

        asyncio.run(scenario())


class TestReplay:
    def test_last_event_id_replays_missing(self):
        """DoD：断连期间的事件重连后按 Last-Event-ID 补发。"""
        async def scenario():
            session = make_session("s2")
            for i in range(5):
                session._log_event("news", {"headline": f"t{i}", "source": "template"})
            gen = _event_stream(session, 3)  # 断线前收到 id=3
            frames = await collect_frames(gen, 2)
            assert [f["id"] for f in frames] == ["4", "5"]
            assert all(f["event"] == "news" for f in frames)
            await gen.aclose()

        asyncio.run(scenario())

    def test_overflow_falls_back_to_snapshot(self):
        """DoD：缓冲溢出按快照恢复（06 §4 末条）。"""
        async def scenario():
            session = make_session("s3")
            session.broadcaster._buffer.clear()
            for i in range(250):  # 溢出 200 环形
                session._log_event("tick", {"at_year": 1, "delta": {"n": i}})
            gen = _event_stream(session, 1)  # last_id=1 早已被挤出
            frames = await collect_frames(gen, 2)
            assert [f["event"] for f in frames] == ["phase_change", "tick"]
            await gen.aclose()

        asyncio.run(scenario())

    def test_live_events_after_replay(self):
        async def scenario():
            session = make_session("s4")
            session._log_event("news", {"headline": "a", "source": "template"})
            gen = _event_stream(session, 1)  # 无补发（id=1 即最新）
            session._log_event("news", {"headline": "b", "source": "template"})
            frames = await collect_frames(gen, 1)
            assert frames[0]["id"] == "2"
            assert "b" in frames[0]["data"]
            await gen.aclose()

        asyncio.run(scenario())


class TestHeartbeat:
    def test_heartbeat_task_emits_empty_delta_tick(self):
        async def scenario():
            session = make_session("s5")
            task = start_heartbeat(session, interval=0.02)
            assert task is not None
            await asyncio.sleep(0.09)
            task.cancel()
            ticks = [e for e in session.event_log if e["event"] == "tick"]
            assert len(ticks) >= 2
            data = ticks[0]["data"]
            assert data["delta"] == {}
            MetricsDiff.model_validate(data)

        asyncio.run(scenario())


class TestTimerEvents:
    def test_phase_change_contract_shape(self):
        session = make_session("s6")
        session.advance()  # briefing → build
        event = session.event_log[-1]
        assert event["event"] == "phase_change"
        assert event["data"]["phase"] == "build"
        assert event["data"]["time_left_sec"] > 0

    def test_settle_tick_has_real_delta(self):
        session = make_session("s7")
        session.advance()
        session.place(TileType.RES_MID, [10, 10])
        session.settle_year()
        tick = [e for e in session.event_log if e["event"] == "tick"][-1]
        MetricsDiff.model_validate(tick["data"])
        assert tick["data"]["at_year"] == 2
        assert tick["data"]["after"]["population"] >= 0

    def test_finalize_emits_locked_phase_change(self):
        session = make_session("s8")
        session.advance()
        session.finalize()
        events = [e["event"] for e in session.event_log]
        assert "phase_change" in events
        locked = [
            e for e in session.event_log
            if e["event"] == "phase_change" and e["data"]["phase"] == "locked"
        ]
        assert locked


class TestProjectionPlayback:
    def test_full_playback_template(self):
        async def scenario():
            session = make_session("s9")
            session.advance()
            session.place(TileType.RES_MID, [10, 10])
            result = session.finalize()
            now = [0.0]
            narrator = make_narrator(now)
            await run_playback(session, narrator, step_sec=0.001)
            steps = [e for e in session.event_log if e["event"] == "projection_step"]
            assert len(steps) == 10
            assert all(e["data"]["source"] == "template" for e in steps)
            assert session.projection_published_year == steps[-1]["data"]["year"]
            ready = [e for e in session.event_log if e["event"] == "report_ready"]
            assert len(ready) == 1
            assert ready[0]["data"]["report"]["source"] == "template"
            assert ready[0]["data"]["city_name"] == result.city_name
            assert session.phase is Phase.REPORT
            assert session.event_log[-1]["data"]["phase"] == "report"

        asyncio.run(scenario())

    def test_playback_with_ai_report(self):
        async def scenario():
            dims = {
                key: "这一维度点评到位。" * 4
                for key in ("population", "balance", "green", "traffic", "happiness")
            }
            payload = {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "overview": "总体诊断" * 28,
                                    "dimensions": dims,
                                    "ending_story": "十年后的结局故事。" * 20,
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            }
            transport = httpx.MockTransport(lambda req: httpx.Response(200, json=payload))
            now = [0.0]
            narrator = make_narrator(
                now, settings=Settings(llm_api_key="k"), transport=transport
            )
            session = make_session("s10")
            session.advance()
            session.finalize()
            await run_playback(session, narrator, step_sec=0.001)
            ready = [e for e in session.event_log if e["event"] == "report_ready"][0]
            assert ready["data"]["report"]["source"] == "ai"
            assert session.finalize_result.report.source.value == "ai"

        asyncio.run(scenario())

    def test_ensure_playback_idempotent(self):
        async def scenario():
            from app.api.playback import ensure_playback

            session = make_session("s11")
            session.advance()
            session.finalize()
            now = [0.0]
            narrator = make_narrator(now)
            task1 = ensure_playback(session, narrator, step_sec=0.001)
            task2 = ensure_playback(session, narrator, step_sec=0.001)
            assert task1 is not None and task2 is None
            await task1
            steps = [e for e in session.event_log if e["event"] == "projection_step"]
            assert len(steps) == 10  # 没有重复播放

        asyncio.run(scenario())

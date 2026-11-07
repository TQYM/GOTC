"""Broadcaster 单测（06 §4）：单调 id、200 环形、补发/溢出、订阅扇出。"""

import asyncio

from app.core.broadcaster import Broadcaster


def test_monotonic_ids_and_ring_capacity():
    bc = Broadcaster(capacity=200)
    for i in range(250):
        assert bc.publish("tick", {"n": i}) == i + 1
    history = bc.history()
    assert len(history) == 200
    assert history[0]["id"] == 51  # 溢出丢弃最旧
    assert history[-1]["id"] == 250
    assert bc.latest_id == 250


def test_replay_after_within_buffer():
    bc = Broadcaster()
    for i in range(5):
        bc.publish("news", {"n": i})
    replay = bc.replay_after(3)
    assert [e.id for e in replay] == [4, 5]
    assert bc.replay_after(5) == []


def test_replay_overflow_returns_none_for_snapshot():
    bc = Broadcaster(capacity=3)
    for _ in range(5):
        bc.publish("tick", {})
    assert bc.replay_after(1) is None  # 最旧 id=3 > 1+1 → 快照恢复
    assert bc.replay_after(3) is not None


def test_subscribe_fanout_and_unsubscribe():
    async def scenario():
        bc = Broadcaster()
        q1, q2 = bc.subscribe(), bc.subscribe()
        assert bc.subscriber_count == 2
        bc.publish("news", {"x": 1})
        e1, e2 = q1.get_nowait(), q2.get_nowait()
        assert e1.id == e2.id == 1
        bc.unsubscribe(q1)
        bc.publish("news", {"x": 2})
        assert q1.empty() and q2.get_nowait().id == 2

    asyncio.run(scenario())


def test_sse_frame_shape():
    bc = Broadcaster()
    bc.publish("news", {"headline": "测试", "source": "template"})
    frame = bc.history() and bc.replay_after(0)[0].sse_frame()
    assert frame["id"] == "1" and frame["event"] == "news"
    assert '"headline": "测试"' in frame["data"]

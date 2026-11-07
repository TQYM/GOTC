"""市民之声测试（PR-11 DoD）：放学校必出 edu、幸福度<40 负面上升、人设不串 20 条。"""

import random

from app.contracts.tile import TileType
from app.core.personas import PERSONAS
from app.core.session import GameSession
from app.narrate.router import (
    TOPIC_PERSONAS,
    citizen_sentiment,
)
from tests.narrate.test_news import make_narrator, run
from tests.sim.test_livability import CONFIG, make_parcel


def drive_placements(narrator, session, tile_types, happiness=None):
    """连续放置（可伪造幸福度）并收集 citizen 事件。"""
    session.advance()
    anchors = [[6 + 4 * (i % 8), 6 + 4 * (i // 8)] for i in range(len(tile_types))]
    for tile_type, anchor in zip(tile_types, anchors, strict=True):
        before = session.metrics
        _, after, _, _ = session.place(tile_type, anchor)
        if happiness is not None:
            after = after.model_copy(update={"happiness": happiness})
        run(narrator.after_operation(session, before, after, tile_type.value, anchor))
    return [e["data"] for e in session.event_log if e["event"] == "citizen"]


class TestTopicRouting:
    def test_school_always_edu(self):
        """DoD：放学校必出 edu 主题（每 3 次放置 1 条，学校放第 3 位）。"""
        now = [0.0]
        narrator = make_narrator(now)
        session = GameSession("c1", parcel=make_parcel(), config=CONFIG)

        events = drive_placements(
            narrator,
            session,
            [TileType.RES_MID, TileType.COM_SHOP, TileType.EDU_SCHOOL],
        )
        assert len(events) == 1
        assert events[0]["topic"] == "edu"
        assert events[0]["persona"] == "带娃妈妈王姐"


class TestSentimentDistribution:
    def test_negative_share_rises_when_unhappy(self):
        """DoD：幸福度<40 负面占比明显上升（PR 附样例数据）。"""
        low = [citizen_sentiment(30, random.Random(f"s:{i}")) for i in range(200)]
        high = [citizen_sentiment(80, random.Random(f"s:{i}")) for i in range(200)]
        low_angry = low.count("angry") / len(low)
        high_happy = high.count("happy") / len(high)
        assert low_angry >= 0.6  # 期望 ≈0.7
        assert high_happy >= 0.55  # 期望 ≈0.65
        assert low_angry > high.count("angry") / len(high)
        print(f"\n[sample] happiness=30 angry={low_angry:.0%}; happiness=80 happy={high_happy:.0%}")


class TestPersonaConsistency:
    def test_twenty_events_no_persona_crossing(self):
        """DoD：连续 20 条人设不串——persona 必须属于该 topic 的允许人设。"""
        now = [0.0]
        narrator = make_narrator(now)
        session = GameSession("c2", parcel=make_parcel(), config=CONFIG)
        # 60 次放置 ×平均 7 万 = 420 万 < 500 万初始资金 → 20 条 citizen
        cycle = [TileType.RES_LOW, TileType.TRANS_ROAD]
        tiles = [cycle[i % 2] for i in range(60)]
        events = drive_placements(narrator, session, tiles)
        assert len(events) == 20
        for event in events:
            allowed = [PERSONAS[k].name for k in TOPIC_PERSONAS[event["topic"]]]
            assert event["persona"] in allowed
            assert len(event["text"]) <= 60

    def test_no_immediate_repeat_per_persona(self):
        now = [0.0]
        narrator = make_narrator(now)
        session = GameSession("c3", parcel=make_parcel(), config=CONFIG)
        tiles = [TileType.GREEN_PARK] * 12  # 同一话题同一人设连发 4 条
        events = drive_placements(narrator, session, tiles)
        assert len(events) == 4
        texts = [e["text"] for e in events]
        for i in range(1, len(texts)):
            assert texts[i] != texts[i - 1]  # 相邻不重复


class TestSentimentEventShape:
    def test_event_fields(self):
        now = [0.0]
        narrator = make_narrator(now)
        session = GameSession("c4", parcel=make_parcel(), config=CONFIG)
        events = drive_placements(
            narrator, session, [TileType.GREEN_PARK] * 3, happiness=80
        )
        assert events[0]["sentiment"] in ("happy", "neutral")
        assert events[0]["topic"] == "green"
        assert events[0]["persona"] == "退休教师陈伯"

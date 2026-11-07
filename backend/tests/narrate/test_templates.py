"""模板槽位库测试（PR-09 DoD：不配 key 模板链路全通）。"""

import pytest

from app.contracts.finalize import Ending, Scores
from app.contracts.tile import TileType
from app.core.personas import PERSONAS, SENTIMENTS, TOPICS
from app.narrate.templates import (
    CITIZEN_TEMPLATES,
    render_citizen,
    render_mentor,
    render_mentor_top3,
    render_news,
    render_report,
)
from app.sim import engine
from tests.sim.test_livability import CONFIG, make_parcel, make_tile


class TestNews:
    def test_shape_and_slots(self):
        news = render_news("green_ratio", 0.31, up=True, cause_tile="green_park", severity="info")
        assert len(news["headline"]) <= 20
        assert "绿地率" in news["body"] and "公园" in news["body"]
        assert news["severity"] == "info"


class TestCitizen:
    def test_all_sentiment_topic_pairs_have_templates(self):
        for sentiment in SENTIMENTS:
            for topic in TOPICS:
                assert CITIZEN_TEMPLATES[sentiment][topic]

    def test_render_and_length(self):
        result = render_citizen("angry", "commute", place="人民路", value="75")
        assert result["text"] and len(result["text"]) <= 60
        assert result["sentiment"] == "angry"

    def test_variants_deterministic(self):
        a = render_citizen("happy", "green", variant=1, place="滨河")
        b = render_citizen("happy", "green", variant=1, place="滨河")
        assert a == b

    def test_five_personas(self):
        assert len(PERSONAS) == 5


class TestMentor:
    def test_green_rule(self):
        tiles = [make_tile(TileType.RES_MID, [10, 10])]
        m = engine.recompute(make_parcel(), tiles, CONFIG, funds=5_000_000)
        mentor = render_mentor(m)  # 全平原绿地率 0 → 命中绿地条款
        assert mentor["theory_refs"] == ["green_network"]
        assert len(mentor["comment"]) <= 120

    def test_top3_cap(self):
        m = engine.recompute(make_parcel(), [], CONFIG, funds=5_000_000)
        assert len(render_mentor_top3(m)) <= 3


class TestReport:
    @pytest.mark.parametrize(
        "ending",
        [
            Ending.BANKRUPT,
            Ending.ECO_PARADISE,
            Ending.GRIDLOCK,
            Ending.GHOST_TOWN,
            Ending.THRIVING,
            Ending.ORDINARY,
        ],
    )
    def test_three_parts_and_length(self, ending):
        tiles = [make_tile(TileType.RES_MID, [10, 10]), make_tile(TileType.COM_SHOP, [10, 20])]
        m = engine.recompute(make_parcel(), tiles, CONFIG, funds=5_000_000)
        scores = Scores(population=80, balance=40, green=20, traffic=90, happiness=66)
        text = render_report(m, scores, ending)
        assert "【总体诊断】" in text
        assert "【五维点评】" in text
        assert "【结局故事" in text
        assert 400 <= len(text) <= 700, f"{ending}: {len(text)}"

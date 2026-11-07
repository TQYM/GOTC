"""模板槽位库测试（PR-09 DoD：不配 key 模板链路全通）。"""

from app.contracts.tile import TileType
from app.core.personas import PERSONAS, SENTIMENTS, TOPICS
from app.narrate.templates import (
    CITIZEN_TEMPLATES,
    render_citizen,
    render_mentor,
    render_mentor_top3,
    render_news,
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

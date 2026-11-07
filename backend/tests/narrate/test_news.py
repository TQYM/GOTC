"""数据大脑测试（PR-10 DoD）：阈值、8s 节流合并、10 次放置 ≥3 条不重复、AI/模板链路。"""

import asyncio
import json

import httpx

from app.config import Settings
from app.contracts.tile import TileType
from app.core.llm import LLMClient
from app.core.session import GameSession
from app.narrate.router import Narrator, significant_changes
from app.sim.generator import generate_parcel
from tests.sim.test_livability import CONFIG, make_parcel


def make_narrator(now_holder, settings=None, transport=None) -> Narrator:
    settings = settings or Settings()  # 无 key → 模板
    llm = LLMClient(settings, transport=transport)
    return Narrator(settings=settings, llm=llm, now=lambda: now_holder[0])


def run(coro):
    return asyncio.run(coro)


class TestThresholds:
    def test_small_change_no_news(self):
        session = GameSession("n0", parcel=make_parcel(), config=CONFIG)
        before = session.metrics
        after = before.model_copy(update={"funds": before.funds - 1000})
        assert significant_changes(before, after) == []  # funds 不在播报阈值表

    def test_population_threshold(self):
        session = GameSession("n1", parcel=make_parcel(), config=CONFIG)
        before = session.metrics
        after = before.model_copy(update={"population": 600})
        changes = significant_changes(before, after)
        assert changes[0][0] == "population"


class TestThrottle:
    def test_merge_within_8s(self):
        now = [1000.0]
        narrator = make_narrator(now)
        session = GameSession("n2", parcel=make_parcel(), config=CONFIG)
        before = session.metrics
        after1 = before.model_copy(update={"population": 900})
        news = run(narrator.after_operation(session, before, after1, "res_mid"))
        assert news is not None
        # 窗口内第二次：不播，挂起合并
        after2 = after1.model_copy(update={"population": 1800})
        assert run(narrator.after_operation(session, after1, after2, "res_mid")) is None
        assert narrator.state_of(session).pending is not None
        # 窗口过后 flush：合并 before=最初 → 新值 1800
        now[0] += 9
        merged = run(narrator.flush(session))
        assert merged is not None
        assert "1800" in merged["headline"]


class TestTenPlacements:
    def test_at_least_3_unique_news(self):
        """DoD：放置 10 次产出 ≥3 条且不重复（无 key 模板链路）。"""
        now = [0.0]
        narrator = make_narrator(now)
        session = GameSession("n3", parcel=make_parcel(), config=CONFIG)
        session.advance()
        placements = [  # 总造价 312 万 < 500 万初始资金
            (TileType.RES_HIGH, [8, 8]),
            (TileType.RES_MID, [14, 8]),
            (TileType.COM_SHOP, [20, 8]),
            (TileType.GREEN_PARK, [26, 8]),
            (TileType.EDU_SCHOOL, [32, 8]),
            (TileType.TRANS_ROAD, [38, 8]),
            (TileType.COM_SHOP, [8, 20]),
            (TileType.GREEN_PARK, [14, 20]),
            (TileType.RES_LOW, [20, 20]),
            (TileType.TRANS_ROAD, [26, 20]),
        ]
        for i, (tile_type, anchor) in enumerate(placements):
            before = session.metrics
            _, after, _, _ = session.place(tile_type, anchor)
            run(narrator.after_operation(session, before, after, tile_type.value))
            now[0] += 9  # 越过 8s 节流
            if i % 3 == 0:
                run(narrator.flush(session))
        headlines = narrator.state_of(session).headlines
        news_events = [e for e in session.event_log if e["event"] == "news"]
        assert len(news_events) >= 3
        titles = [e["data"]["headline"] for e in news_events]
        assert len(set(titles)) == len(titles)  # 不重复
        assert all(len(t) <= 20 for t in titles)
        assert headlines == titles[-3:]


class TestAIPath:
    def test_ai_success(self):
        payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "headline": "人口净流入提速",
                                "body": "环比上周，人口又涨了。",
                                "severity": "info",
                            },
                            ensure_ascii=False,
                        )
                    }
                }
            ]
        }
        transport = httpx.MockTransport(lambda req: httpx.Response(200, json=payload))
        now = [0.0]
        narrator = make_narrator(now, settings=Settings(llm_api_key="k"), transport=transport)
        session = GameSession("n4", parcel=make_parcel(), config=CONFIG)
        before = session.metrics
        after = before.model_copy(update={"population": 900})
        news = run(narrator.after_operation(session, before, after, "res_mid"))
        assert news["headline"] == "人口净流入提速"

    def test_ai_invalid_json_falls_back(self):
        payload = {"choices": [{"message": {"content": "不是 JSON"}}]}
        transport = httpx.MockTransport(lambda req: httpx.Response(200, json=payload))
        now = [0.0]
        narrator = make_narrator(now, settings=Settings(llm_api_key="k"), transport=transport)
        session = GameSession("n5", parcel=make_parcel(), config=CONFIG)
        before = session.metrics
        after = before.model_copy(update={"population": 900})
        news = run(narrator.after_operation(session, before, after, "res_mid"))
        assert news is not None
        assert "人口" in news["headline"]  # 模板槽位


class TestRealSession:
    def test_generated_parcel_news(self):
        now = [0.0]
        narrator = make_narrator(now)
        parcel = generate_parcel(882314, CONFIG)
        session = GameSession("n6", parcel=parcel, config=CONFIG)
        session.advance()
        river = next(
            (r, c)
            for r, row in enumerate(parcel.terrain)
            for c, t in enumerate(row)
            if t.value == "flat"
        )
        before = session.metrics
        _, after, _, _ = session.place(TileType.RES_MID, list(river))
        news = run(narrator.after_operation(session, before, after, "res_mid"))
        assert news is not None
        assert session.event_log[-1]["event"] == "news"
        assert session.event_log[-1]["data"]["at_year"] == 1

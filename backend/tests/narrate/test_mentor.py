"""规划导师测试（PR-12 DoD）：90s 节流、polish Top3、theory_refs 允许值、AI/模板双链路。"""

import json

import httpx

from app.config import Settings
from app.contracts.common import Source
from app.contracts.metrics import Phase
from app.core.report import report_length
from app.core.session import GameSession
from app.narrate.router import MENTOR_INTERVAL_SEC
from tests.narrate.test_news import make_narrator, run
from tests.sim.test_livability import CONFIG, make_parcel


def build_session(sid="m0"):
    session = GameSession(sid, parcel=make_parcel(), config=CONFIG)
    session.advance()
    return session


class TestThrottle:
    def test_90s_interval(self):
        now = [100.0]
        narrator = make_narrator(now)
        session = build_session("m1")
        first = run(narrator.mentor_comment(session))
        assert first is not None
        assert first["source"] == "template"
        assert run(narrator.mentor_comment(session)) is None  # 90s 内不重复
        now[0] += MENTOR_INTERVAL_SEC + 1
        second = run(narrator.mentor_comment(session))
        assert second is not None

    def test_briefing_and_finalized_skipped(self):
        now = [0.0]
        narrator = make_narrator(now)
        session = GameSession("m2", parcel=make_parcel(), config=CONFIG)  # briefing 阶段
        assert run(narrator.mentor_comment(session)) is None
        session.advance()
        session.finalize()
        assert run(narrator.mentor_comment(session)) is None


class TestTopIssues:
    def test_polish_top3(self):
        now = [0.0]
        narrator = make_narrator(now)
        session = build_session("m3")
        session.phase = Phase.POLISH
        # 全平原无绿地 + 职住比失衡 + 覆盖不足 → 多个结构问题
        event = run(narrator.mentor_comment(session))
        assert 1 <= len(event["top_issues"]) <= 3
        assert all(isinstance(issue, str) for issue in event["top_issues"])

    def test_build_phase_no_top_issues(self):
        now = [0.0]
        narrator = make_narrator(now)
        session = build_session("m4")
        event = run(narrator.mentor_comment(session))
        assert event["top_issues"] == []


class TestTheoryRefs:
    def test_only_allowed_values(self):
        now = [0.0]
        narrator = make_narrator(now)
        session = build_session("m5")
        for _ in range(6):  # 轮换多条规则
            now[0] += 91
            event = run(narrator.mentor_comment(session))
            assert set(event["theory_refs"]) <= {
                "tod",
                "life_circle_15",
                "jobs_housing_balance",
                "green_network",
                "road_hierarchy",
            }
            assert event["severity"] in ("suggestion", "warning")
            assert len(event["comment"]) <= 120


class TestAI:
    def test_ai_success(self):
        payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "comment": "绿地网络骨架已现，下一步用 TOD 收紧通勤圈。",
                                "theory_refs": ["green_network", "tod"],
                                "severity": "suggestion",
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
        session = build_session("m6")
        event = run(narrator.mentor_comment(session))
        assert event["source"] == "ai"
        assert event["theory_refs"] == ["green_network", "tod"]

    def test_ai_illegal_refs_fallback(self):
        payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {"comment": "评论", "theory_refs": ["量子规划"], "severity": "warning"},
                            ensure_ascii=False,
                        )
                    }
                }
            ]
        }
        transport = httpx.MockTransport(lambda req: httpx.Response(200, json=payload))
        now = [0.0]
        narrator = make_narrator(now, settings=Settings(llm_api_key="k"), transport=transport)
        session = build_session("m7")
        event = run(narrator.mentor_comment(session))
        assert event["source"] == "template"  # 非法引用 → 模板


class TestAIReport:
    def _ai_report_payload(self, overview):
        dims = {key: "这一维度点评到位。" * 4 for key in (
            "population", "balance", "green", "traffic", "happiness"
        )}
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "overview": overview,
                                "dimensions": dims,
                                "ending_story": "十年后的结局故事。" * 20,
                            },
                            ensure_ascii=False,
                        )
                    }
                }
            ]
        }

    def test_ai_report_success(self):
        # overview 110 字 + dims 5×40 字 + story 160 字 ≈ 470 字
        transport = httpx.MockTransport(
            lambda req: httpx.Response(200, json=self._ai_report_payload("总体诊断" * 28))
        )
        now = [0.0]
        narrator = make_narrator(now, settings=Settings(llm_api_key="k"), transport=transport)
        session = build_session("m8")
        result = session.finalize()
        report = run(narrator.ai_report(session, result))
        assert report is not None
        assert report.source is Source.AI
        assert 400 <= report_length(report) <= 700

    def test_ai_report_too_short_fallback(self):
        transport = httpx.MockTransport(
            lambda req: httpx.Response(200, json=self._ai_report_payload("太短"))
        )
        now = [0.0]
        narrator = make_narrator(now, settings=Settings(llm_api_key="k"), transport=transport)
        session = build_session("m9")
        result = session.finalize()
        assert run(narrator.ai_report(session, result)) is None  # 字数越界 → None → 模板

    def test_no_key_returns_none(self):
        now = [0.0]
        narrator = make_narrator(now)
        session = build_session("m10")
        result = session.finalize()
        assert run(narrator.ai_report(session, result)) is None

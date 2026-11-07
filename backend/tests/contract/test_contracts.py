"""契约样例测试（PR-01 DoD）：contracts 模型能解析 02 文档全部 JSON 形状。

样例按 02 文档各节的示例构造；字段名/枚举值与文档逐字对齐。
"""

import pytest
from pydantic import ValidationError

from app.contracts import (
    HTTP_STATUS_BY_CODE,
    AdvanceResponse,
    CitizenEvent,
    CreateSessionRequest,
    Ending,
    ErrorCode,
    ErrorEnvelope,
    FinalizeResult,
    MentorEvent,
    MentorSeverity,
    Metrics,
    MetricsDiff,
    NewsEvent,
    NewsSeverity,
    Parcel,
    Phase,
    PhaseChangeEvent,
    PlaceRequest,
    PlaceResult,
    ProjectionStep,
    RemoveRequest,
    ReportReadyEvent,
    SessionCreated,
    SessionState,
    SseErrorEvent,
    Terrain,
    Tile,
    TileType,
)

SIZE = 48


def make_terrain() -> list[list[str]]:
    return [[Terrain.FLAT.value] * SIZE for _ in range(SIZE)]


def make_parcel_json() -> dict:
    terrain = make_terrain()
    terrain[0][3] = Terrain.RIVER.value
    terrain[0][4] = Terrain.BANK.value
    terrain[2][2] = Terrain.HILL.value
    terrain[40][40] = Terrain.FOREST.value
    terrain[3][0] = Terrain.ROAD_INHERITED.value
    terrain[4][1] = Terrain.ROAD_INHERITED.value
    return {
        "size": SIZE,
        "cell_size_m": 50,
        "terrain": terrain,
        "inherited_road": [[3, 0], [4, 1]],
        "constraints": {
            "height_limit_m": 80,
            "green_line_m": 30,
            "buildable_ratio": 0.74,
            "briefing": "本地块限高80m，河道两侧30m绿线，省道保留不可拆。",
        },
        "seed": 882314,
    }


def make_metrics_json() -> dict:
    return {
        "at_year": 2,
        "at_phase": "build",
        "funds": 4310000,
        "population": 8200,
        "jobs": 6100,
        "job_res_ratio": 0.74,
        "land_price_index": 118.4,
        "green_ratio": 0.31,
        "avg_commute": 34,
        "congestion": 0.52,
        "pollution": 0.18,
        "happiness": 63,
        "tax_income": 1260000,
        "upkeep": 480000,
        "coverage_edu": 0.66,
        "coverage_med": 0.41,
    }


def make_tile_json() -> dict:
    return {
        "id": "tile_7f3a",
        "type": "res_mid",
        "anchor": [12, 7],
        "cells": [[12, 7]],
        "built_at_year": 1,
        "upkeep": 12000,
    }


class TestParcel:
    def test_doc_sample_shape_parses(self):
        parcel = Parcel.model_validate(make_parcel_json())
        assert parcel.size == 48
        assert parcel.cell_size_m == 50
        assert parcel.seed == 882314
        assert parcel.terrain[0][3] is Terrain.RIVER
        assert parcel.terrain[3][0] is Terrain.ROAD_INHERITED
        assert parcel.inherited_road == [[3, 0], [4, 1]]
        assert parcel.constraints.buildable_ratio == pytest.approx(0.74)

    def test_terrain_must_be_square(self):
        bad = make_parcel_json()
        bad["terrain"] = bad["terrain"][:47]
        with pytest.raises(ValidationError):
            Parcel.model_validate(bad)

    def test_inherited_road_coord_shape(self):
        bad = make_parcel_json()
        bad["inherited_road"] = [[3, 0, 9]]
        with pytest.raises(ValidationError):
            Parcel.model_validate(bad)


class TestTile:
    def test_doc_sample_parses(self):
        tile = Tile.model_validate(make_tile_json())
        assert tile.type is TileType.RES_MID
        assert tile.anchor == [12, 7]

    def test_all_14_tile_types_exist(self):
        assert len(TileType) == 14

    def test_anchor_must_be_coord(self):
        bad = make_tile_json()
        bad["anchor"] = [12]
        with pytest.raises(ValidationError):
            Tile.model_validate(bad)


class TestMetrics:
    def test_doc_sample_parses(self):
        m = Metrics.model_validate(make_metrics_json())
        assert m.at_phase is Phase.BUILD
        assert m.happiness == 63

    def test_diff_only_carries_changed_fields(self):
        diff = MetricsDiff.model_validate(
            {"at_year": 2, "delta": {"population": 1200, "happiness": -3, "congestion": 0.08}}
        )
        assert diff.after is None
        assert set(diff.delta) == {"population", "happiness", "congestion"}

    def test_all_5_phases_exist(self):
        assert {p.value for p in Phase} == {"briefing", "build", "polish", "locked", "report"}


class TestErrorProtocol:
    def test_doc_sample_envelope_parses(self):
        env = ErrorEnvelope.model_validate(
            {
                "error": {
                    "code": "invalid_placement",
                    "message": "目标格子不可建设（terrain=river）",
                    "details": {"cells": [[12, 7]]},
                }
            }
        )
        assert env.error.code is ErrorCode.INVALID_PLACEMENT
        assert env.error.details == {"cells": [[12, 7]]}

    def test_every_code_maps_to_doc_http_status(self):
        expected = {
            "invalid_placement": 400,
            "invalid_phase": 400,
            "insufficient_funds": 402,
            "session_not_found": 404,
            "cell_occupied": 409,
            "invalid_payload": 422,
            "internal_error": 500,
        }
        for code, status in expected.items():
            assert HTTP_STATUS_BY_CODE[ErrorCode(code)] == status


class TestSseEventShapes:
    def test_news(self):
        e = NewsEvent.model_validate(
            {
                "headline": "地价环比涨8%",
                "body": "商务中心带动周边住宅地价上行。",
                "severity": "info",
                "at_year": 2,
            }
        )
        assert e.severity is NewsSeverity.INFO

    def test_citizen(self):
        e = CitizenEvent.model_validate(
            {
                "persona": "程序员小李",
                "text": "@市长 城东通勤转三趟车😡",
                "sentiment": "angry",
                "topic": "commute",
            }
        )
        assert e.topic.value == "commute"

    def test_mentor(self):
        e = MentorEvent.model_validate(
            {
                "comment": "职住比失衡，建议沿地铁线补住宅。",
                "theory_refs": ["tod", "jobs_housing_balance"],
                "severity": "suggestion",
            }
        )
        assert len(e.theory_refs) == 2
        assert e.severity is MentorSeverity.SUGGESTION

    def test_phase_change(self):
        e = PhaseChangeEvent.model_validate({"phase": "build", "time_left_sec": 900})
        assert e.phase is Phase.BUILD

    def test_projection_step(self):
        e = ProjectionStep.model_validate({"year": 4, "metrics": make_metrics_json()})
        assert e.year == 4
        assert e.metrics.population == 8200

    def test_report_ready(self):
        e = ReportReadyEvent.model_validate(
            {"report_text": "这座为通勤而建的城市……", "city_name": "江湾市"}
        )
        assert e.city_name == "江湾市"

    def test_error_event(self):
        e = SseErrorEvent.model_validate(
            {"code": "llm_unavailable", "message": "AI 叙述层暂时离线"}
        )
        assert e.code == "llm_unavailable"


class TestSessionShapes:
    def test_session_created(self):
        s = SessionCreated.model_validate(
            {
                "session_id": "ses_x7k2",
                "parcel": make_parcel_json(),
                "phase": "briefing",
                "time_left_sec": 20,
                "funds": 5000000,
            }
        )
        assert s.phase is Phase.BRIEFING
        assert s.funds == 5000000

    def test_session_state(self):
        s = SessionState.model_validate(
            {
                "session_id": "ses_x7k2",
                "phase": "build",
                "time_left_sec": 512,
                "parcel": make_parcel_json(),
                "tiles": [make_tile_json()],
                "metrics": make_metrics_json(),
                "placements_count": 23,
            }
        )
        assert s.placements_count == 23
        assert len(s.tiles) == 1

    def test_place_result(self):
        r = PlaceResult.model_validate(
            {
                "tile": make_tile_json(),
                "metrics": make_metrics_json(),
                "metrics_diff": {"at_year": 2, "delta": {"population": 900}},
                "funds_after": 4090000,
            }
        )
        assert r.funds_after == 4090000

    def test_advance_response(self):
        r = AdvanceResponse.model_validate({"phase": "build", "time_left_sec": 900})
        assert r.time_left_sec == 900


class TestFinalize:
    def test_doc_sample_parses(self):
        metrics = make_metrics_json()
        result = FinalizeResult.model_validate(
            {
                "phase": "locked",
                "projection": [
                    {"year": 4, "metrics": metrics, "events": ["人口流入放缓"]},
                    {"year": 5, "metrics": metrics, "events": ["cbd地价上涨12%"]},
                ],
                "ending": "thriving",
                "scores": {
                    "population": 72,
                    "balance": 88,
                    "green": 64,
                    "traffic": 51,
                    "happiness": 77,
                },
                "report_text": "这座为通勤而建的城市，最终困住了所有人……",
            }
        )
        assert result.ending is Ending.THRIVING
        assert result.scores.traffic == 51
        assert len(result.projection) == 2

    def test_all_6_endings_exist(self):
        assert len(Ending) == 6


class TestRequests:
    def test_create_session_seed_optional(self):
        assert CreateSessionRequest.model_validate({}).seed is None
        assert CreateSessionRequest.model_validate({"seed": 882314}).seed == 882314

    def test_place_request(self):
        r = PlaceRequest.model_validate({"type": "res_mid", "anchor": [12, 7]})
        assert r.type is TileType.RES_MID

    def test_remove_request(self):
        assert RemoveRequest.model_validate({"tile_id": "tile_7f3a"}).tile_id == "tile_7f3a"

"""终局结构化报告模板测试（PR-12 DoD：400–700 字、三段式齐全、六结局）。"""

import pytest

from app.contracts.common import Source
from app.contracts.finalize import Ending, Scores
from app.contracts.tile import TileType
from app.core.report import build_template_report, report_length
from app.sim import engine
from tests.sim.test_livability import CONFIG, make_parcel, make_tile


@pytest.mark.parametrize("ending", list(Ending))
def test_three_parts_and_length(ending):
    tiles = [make_tile(TileType.RES_MID, [10, 10]), make_tile(TileType.COM_SHOP, [10, 20])]
    m = engine.recompute(make_parcel(), tiles, CONFIG, funds=5_000_000)
    scores = Scores(population=80, balance=40, green=20, traffic=90, happiness=66)
    report = build_template_report("江湾市", m, scores, ending)
    assert report.source is Source.TEMPLATE
    assert report.overview and report.ending_story
    for key in ("population", "balance", "green", "traffic", "happiness"):
        assert getattr(report.dimensions, key)
    assert 400 <= report_length(report) <= 700, f"{ending}: {report_length(report)}"


def test_finalize_returns_full_template_report():
    from app.core.session import GameSession

    session = GameSession("r1", parcel=make_parcel(), config=CONFIG)
    session.advance()
    session.place(TileType.RES_MID, [10, 10])
    result = session.finalize()
    assert result.city_name
    assert result.city_name_source is Source.TEMPLATE
    assert result.report.source is Source.TEMPLATE
    assert 400 <= report_length(result.report) <= 700
    # 幂等：第二次同一对象
    assert session.finalize() is result

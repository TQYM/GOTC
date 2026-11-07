"""saves v2 REST 契约：建城、年度、推演、报告与错误信封。"""

import pytest
from fastapi.testclient import TestClient

from app.api import saves as saves_module
from app.config import Settings, load_sim_config
from app.contracts.tile import TileType
from app.core.repository import SaveRepository
from app.core.service import SaveService
from app.main import app
from app.sim.catalog import expand_cells

SEED = 882314


@pytest.fixture()
def client(tmp_path):
    settings = Settings(
        database_path=str(tmp_path / "city20.db"),
        parcel_data_dir=str(tmp_path / "parcels"),
        llm_api_key=None,
    )
    fresh = SaveService(
        SaveRepository(settings.database_path),
        config=load_sim_config(),
        settings=settings,
    )
    original = saves_module.service
    saves_module.service = fresh
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        saves_module.service = original


def create(client: TestClient, *, start: bool = True) -> dict:
    response = client.post("/api/saves", json={"seed": SEED, "parcel_id": "sandbox"})
    assert response.status_code == 201, response.text
    data = response.json()
    assert len(data["city_code"]) == 8
    assert data["phase"] == "briefing"
    assert data["city_year"] == 1
    assert data["last_seq"] == 0
    assert "time_left_sec" not in data
    if start:
        response = client.post(f"/api/saves/{data['city_code']}/start", json={})
        assert response.status_code == 200
        data = response.json()
        assert data["phase"] == "building"
    return data


def find_cell(parcel: dict, terrain: str, *, offset: int = 0) -> list[int]:
    found = [
        [r, c]
        for r, row in enumerate(parcel["terrain"])
        for c, value in enumerate(row)
        if value == terrain
    ]
    return found[offset]


def find_cbd_anchor(parcel: dict, excluded: set[tuple[int, int]] | None = None) -> list[int]:
    excluded = excluded or set()
    for r, row in enumerate(parcel["terrain"]):
        for c, _terrain in enumerate(row):
            cells = expand_cells(TileType.COM_CBD, [r, c])
            coords = {(cr, cc) for cr, cc in cells}
            if coords & excluded or any(
                cr < 0 or cc < 0 or cr >= parcel["size"] or cc >= parcel["size"]
                for cr, cc in cells
            ):
                continue
            if all(parcel["terrain"][cr][cc] == "flat" for cr, cc in cells):
                return [r, c]
    raise AssertionError("没有两个可用的 CBD 锚点")


def operation(client: TestClient, code: str, name: str, payload: dict, suffix: str = "1"):
    return client.post(
        f"/api/saves/{code}/{name}",
        json={**payload, "client_op_id": f"web-{name}-{suffix}", "base_seq": 0},
    )


def test_place_advance_project_report_history(client: TestClient):
    save = create(client)
    code = save["city_code"]
    anchor = find_cell(save["parcel"], "flat")
    placed = operation(client, code, "place", {"type": "res_mid", "anchor": anchor})
    assert placed.status_code == 200, placed.text
    result = placed.json()
    assert result["seq"] == 1
    assert result["tile"]["id"] == "tile_00000001"
    assert result["metrics"]["population"] == 0  # 新住宅从实际入住 0 开始
    assert result["metrics_diff"]["after"] == result["metrics"]
    assert result["tiles"][0]["anchor"] == anchor

    advanced = operation(client, code, "advance", {})
    assert advanced.status_code == 200, advanced.text
    year = advanced.json()
    assert year["seq"] == 2
    assert year["city_year"] == 2
    assert year["metrics"]["population"] == 72  # 900×8%
    assert year["annual_events"] == []

    before_project = client.get(f"/api/saves/{code}").json()
    projected = client.post(f"/api/saves/{code}/project", json={"years": 3})
    assert projected.status_code == 200, projected.text
    projection = projected.json()
    assert projection["base_year"] == 2
    assert projection["base_seq"] == 2
    assert [step["year"] for step in projection["projection"]] == [3, 4, 5]
    assert all(step["metrics"]["at_phase"] == "projecting" for step in projection["projection"])
    assert client.get(f"/api/saves/{code}").json() == before_project

    report = client.post(f"/api/saves/{code}/report")
    assert report.status_code == 200, report.text
    payload = report.json()
    assert payload["base_seq"] == 2
    assert payload["report"]["source"] == "template"
    assert payload["report"]["dimensions"].keys() == {
        "population", "balance", "green", "traffic", "happiness"
    }
    assert client.get(f"/api/saves/{code}").json()["last_seq"] == 2
    history = client.get(f"/api/saves/{code}/reports")
    assert history.status_code == 200
    assert history.json()["reports"] == [payload]


def test_idempotent_place_returns_first_result(client: TestClient):
    code = create(client)["city_code"]
    save = client.get(f"/api/saves/{code}").json()
    anchor = find_cell(save["parcel"], "flat")
    body = {
        "type": "res_mid", "anchor": anchor,
        "client_op_id": "retry-once", "base_seq": 0,
    }
    first = client.post(f"/api/saves/{code}/place", json=body)
    second = client.post(f"/api/saves/{code}/place", json={**body, "base_seq": 99})
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    state = client.get(f"/api/saves/{code}").json()
    assert state["last_seq"] == 1
    assert len(state["tiles"]) == 1


def test_remove_and_conflict(client: TestClient):
    code = create(client)["city_code"]
    save = client.get(f"/api/saves/{code}").json()
    anchor = find_cell(save["parcel"], "flat")
    placed = operation(client, code, "place", {"type": "green_park", "anchor": anchor})
    tile_id = placed.json()["tile"]["id"]
    conflict = operation(
        client, code, "place", {"type": "res_low", "anchor": anchor}, suffix="2"
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "cell_occupied"
    removed = operation(client, code, "remove", {"tile_id": tile_id}, suffix="3")
    assert removed.status_code == 200
    assert removed.json()["tile"]["id"] == tile_id
    assert removed.json()["tiles"] == []
    assert removed.json()["seq"] == 2


def test_invalid_phase_payload_river_and_not_found(client: TestClient):
    save = create(client, start=False)
    code = save["city_code"]
    anchor = find_cell(save["parcel"], "flat")
    wrong_phase = operation(client, code, "place", {"type": "res_mid", "anchor": anchor})
    assert wrong_phase.status_code == 400
    assert wrong_phase.json()["error"]["code"] == "invalid_phase"
    assert client.post(f"/api/saves/{code}/start", json={}).status_code == 200
    river = find_cell(save["parcel"], "river")
    invalid = operation(client, code, "place", {"type": "res_mid", "anchor": river})
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "invalid_placement"
    malformed = client.post(f"/api/saves/{code}/advance", json={})
    assert malformed.status_code == 422
    assert malformed.json()["error"]["code"] == "invalid_payload"
    missing = client.get("/api/saves/00000000")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "session_not_found"


def test_insufficient_funds_does_not_consume_seq(client: TestClient):
    code = create(client)["city_code"]
    save = client.get(f"/api/saves/{code}").json()
    first_anchor = find_cbd_anchor(save["parcel"])
    first = operation(
        client, code, "place", {"type": "com_cbd", "anchor": first_anchor}
    )
    assert first.status_code == 200, first.text
    excluded = {
        (r, c)
        for r in range(first_anchor[0], first_anchor[0] + 3)
        for c in range(first_anchor[1], first_anchor[1] + 3)
    }
    second_anchor = find_cbd_anchor(save["parcel"], excluded)
    second = operation(
        client, code, "place",
        {"type": "com_cbd", "anchor": second_anchor}, suffix="2",
    )
    assert second.status_code == 200, second.text
    excluded |= {
        (r, c)
        for r in range(second_anchor[0], second_anchor[0] + 2)
        for c in range(second_anchor[1], second_anchor[1] + 2)
    }
    third = operation(
        client, code, "place",
        {"type": "com_cbd", "anchor": find_cbd_anchor(save["parcel"], excluded)},
        suffix="3",
    )
    assert third.status_code == 402
    assert third.json()["error"]["code"] == "insufficient_funds"
    assert client.get(f"/api/saves/{code}").json()["last_seq"] == 2


def test_report_history_keeps_latest_twenty(client: TestClient):
    code = create(client)["city_code"]
    expected = None
    for _ in range(21):
        response = client.post(f"/api/saves/{code}/report")
        assert response.status_code == 200
        expected = response.json()
    history = client.get(f"/api/saves/{code}/reports").json()["reports"]
    assert len(history) == 20
    assert history[0] == expected


def test_city_code_rate_limit(client: TestClient, monkeypatch):
    monkeypatch.setattr("app.main.settings.rate_limit_per_minute", 2)
    code = create(client, start=False)["city_code"]
    assert client.get(f"/api/saves/{code}").status_code == 200
    assert client.get(f"/api/saves/{code}").status_code == 200
    limited = client.get(f"/api/saves/{code}")
    assert limited.status_code == 429
    assert limited.json()["error"]["details"]["reason"] == "rate_limited"


def test_old_sessions_routes_are_not_exposed(client: TestClient):
    assert client.post("/api/sessions", json={}).status_code == 404
    assert client.get("/healthz").json()["database"]["status"] == "ok"

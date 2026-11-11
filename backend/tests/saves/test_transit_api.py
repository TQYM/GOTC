"""公共交通线路 API：建线 / 加站 / 票价 / 删线。"""

import pytest
from fastapi.testclient import TestClient

from app.api import saves as saves_module
from app.config import Settings, load_sim_config
from app.core.repository import SaveRepository
from app.core.service import SaveService
from app.main import app

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


def _boot(client: TestClient) -> str:
    response = client.post("/api/saves", json={"seed": SEED, "parcel_id": "sandbox"})
    assert response.status_code == 201, response.text
    code = response.json()["city_code"]
    assert client.post(f"/api/saves/{code}/start").status_code == 200
    # 地铁站单价 150 万，先借一笔把测试场地铺起来
    client.post(
        f"/api/saves/{code}/loan",
        json={"amount": 20_000_000, "months": 60, "rate_bp": 500},
    )
    return code


def _place(client: TestClient, code: str, tile_type: str, anchor: list[int]) -> str:
    response = client.post(
        f"/api/saves/{code}/place",
        json={"type": tile_type, "anchor": anchor, "client_op_id": f"p-{anchor[0]}-{anchor[1]}"},
    )
    assert response.status_code == 200, response.text
    return response.json()["tile"]["id"]


def test_create_line_and_see_it_in_view(client: TestClient):
    code = _boot(client)
    a = _place(client, code, "trans_metro", [10, 10])
    b = _place(client, code, "trans_metro", [10, 14])
    response = client.post(
        f"/api/saves/{code}/transit",
        json={"name": "一号线", "kind": "bus", "stops": [a, b], "client_op_id": "t-1"},
    )
    assert response.status_code == 200, response.text
    line = response.json()["line"]
    assert line["name"] == "一号线"
    assert line["kind"] == "bus"
    assert line["stops"] == [a, b]
    view = client.get(f"/api/saves/{code}").json()
    assert [row["lid"] for row in view["transit"]] == [line["lid"]]


def test_line_rejects_non_station_tiles(client: TestClient):
    code = _boot(client)
    station = _place(client, code, "trans_metro", [12, 12])
    home = _place(client, code, "res_low", [12, 16])
    response = client.post(
        f"/api/saves/{code}/transit",
        json={"name": "坏线", "kind": "bus", "stops": [station, home], "client_op_id": "t-2"},
    )
    assert response.status_code == 422, response.text


def test_add_stop_and_price(client: TestClient):
    code = _boot(client)
    a = _place(client, code, "trans_metro", [8, 8])
    b = _place(client, code, "trans_metro", [8, 12])
    c = _place(client, code, "trans_metro", [8, 16])
    created = client.post(
        f"/api/saves/{code}/transit",
        json={"name": "二号线", "kind": "metro", "stops": [a, b], "client_op_id": "t-3"},
    ).json()["line"]
    lid = created["lid"]
    added = client.post(
        f"/api/saves/{code}/transit/stop",
        json={"lid": lid, "tile_id": c, "client_op_id": "t-4"},
    )
    assert added.status_code == 200, added.text
    assert added.json()["line"]["stops_count"] == 3
    priced = client.post(
        f"/api/saves/{code}/transit/price",
        json={"lid": lid, "price": 4.5, "client_op_id": "t-5"},
    )
    assert priced.status_code == 200, priced.text
    assert priced.json()["line"]["price"] == 4.5


def test_delete_line(client: TestClient):
    code = _boot(client)
    a = _place(client, code, "trans_metro", [10, 10])
    b = _place(client, code, "trans_metro", [10, 14])
    lid = client.post(
        f"/api/saves/{code}/transit",
        json={"name": "三号线", "kind": "bus", "stops": [a, b], "client_op_id": "t-6"},
    ).json()["line"]["lid"]
    response = client.post(
        f"/api/saves/{code}/transit/{lid}/delete",
        json={"lid": lid, "client_op_id": "t-7"},
    )
    assert response.status_code == 200, response.text
    view = client.get(f"/api/saves/{code}").json()
    assert view["transit"] == []

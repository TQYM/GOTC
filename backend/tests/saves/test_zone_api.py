"""批量划区：C:S 拖拽刷子的等价接口。"""

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


def create(client: TestClient) -> str:
    response = client.post("/api/saves", json={"seed": SEED, "parcel_id": "sandbox"})
    assert response.status_code == 201, response.text
    code = response.json()["city_code"]
    assert client.post(f"/api/saves/{code}/start").status_code == 200
    return code


def test_zone_places_multiple_tiles_in_one_call(client: TestClient) -> None:
    code = create(client)
    response = client.post(
        f"/api/saves/{code}/zone",
        json={
            "type": "res_low",
            "anchor": [10, 10],
            "rows": 3,
            "cols": 3,
            "client_op_id": "zone-1",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["op_type"] == "zone"
    assert 1 <= len(body["tiles"]) <= 9
    # 造价按个数累计，未建成的格不会扣钱
    assert body["metrics"]["funds"] < 5_000_000


def test_zone_skips_blocked_cells_without_failing(client: TestClient) -> None:
    code = create(client)
    # 18×18 起铺 16×16，必然越界；接口应只放行可建部分而不是整体报错
    response = client.post(
        f"/api/saves/{code}/zone",
        json={
            "type": "res_low",
            "anchor": [18, 18],
            "rows": 16,
            "cols": 16,
            "client_op_id": "zone-2",
        },
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["tiles"]) >= 1


def test_zone_is_idempotent_by_client_op_id(client: TestClient) -> None:
    code = create(client)
    payload = {
        "type": "res_low",
        "anchor": [8, 8],
        "rows": 2,
        "cols": 2,
        "client_op_id": "zone-3",
    }
    first = client.post(f"/api/saves/{code}/zone", json=payload)
    second = client.post(f"/api/saves/{code}/zone", json=payload)
    assert first.status_code == 200 and second.status_code == 200
    assert len(first.json()["tiles"]) == len(second.json()["tiles"])
    assert first.json()["seq"] == second.json()["seq"]


def test_zone_rejects_oversized_brush(client: TestClient) -> None:
    code = create(client)
    response = client.post(
        f"/api/saves/{code}/zone",
        json={
            "type": "res_low",
            "anchor": [4, 4],
            "rows": 17,
            "cols": 1,
            "client_op_id": "zone-4",
        },
    )
    assert response.status_code == 422

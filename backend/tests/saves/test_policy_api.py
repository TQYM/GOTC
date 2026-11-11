"""城市级政策：开关、未知政策、视图暴露。"""

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


def test_policy_round_trip_and_view(client):
    code = create(client)
    response = client.post(
        f"/api/saves/{code}/policy",
        json={"policy": "recycling", "enabled": True, "client_op_id": "p-1"},
    )
    assert response.status_code == 200, response.text

    view = client.post(f"/api/saves/{code}/speed", json={"speed": 0}).json()
    policies = {item["key"]: item["enabled"] for item in view["policies"]}
    assert policies["recycling"] is True
    assert policies["smoke_ban"] is False


def test_unknown_policy_is_rejected(client):
    code = create(client)
    response = client.post(
        f"/api/saves/{code}/policy",
        json={"policy": "space_elevator", "enabled": True, "client_op_id": "p-2"},
    )
    assert response.status_code in (400, 422)


def test_policy_can_be_disabled(client):
    code = create(client)
    client.post(
        f"/api/saves/{code}/policy",
        json={"policy": "free_transit", "enabled": True, "client_op_id": "p-3"},
    )
    client.post(
        f"/api/saves/{code}/policy",
        json={"policy": "free_transit", "enabled": False, "client_op_id": "p-4"},
    )
    view = client.post(f"/api/saves/{code}/speed", json={"speed": 0}).json()
    policies = {item["key"]: item["enabled"] for item in view["policies"]}
    assert policies["free_transit"] is False

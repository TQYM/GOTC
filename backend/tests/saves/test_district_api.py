"""行政区与政策：C:S 的 DistrictManager + SetDistrictPolicy。"""

from __future__ import annotations

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


def _make(client, payload=None):
    created = client.post(
        "/api/saves", json={"seed": SEED, "parcel_id": "sandbox", **(payload or {})}
    )
    assert created.status_code == 201, created.text
    code = created.json()["city_code"]
    assert client.post(f"/api/saves/{code}/start").status_code == 200
    return code


def test_create_district_collects_existing_tiles(client):
    code = _make(client)
    client.post(
        f"/api/saves/{code}/zone",
        json={"type": "res_low", "anchor": [10, 10], "rows": 2, "cols": 2, "client_op_id": "z1"},
    )
    created = client.post(
        f"/api/saves/{code}/district",
        json={"name": "老城", "anchor": [10, 10], "rows": 2, "cols": 2, "client_op_id": "d1"},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["seq"] == 2
    district = client.get(f"/api/saves/{code}").json()
    assert len(district["districts"]) == 1
    assert district["districts"][0]["name"] == "老城"
    assert len(district["districts"][0]["tiles"]) >= 1


def test_district_policy_green_raises_happiness(client):
    code = _make(client)
    client.post(
        f"/api/saves/{code}/zone",
        json={"type": "res_low", "anchor": [10, 10], "rows": 2, "cols": 2, "client_op_id": "z1"},
    )
    client.post(
        f"/api/saves/{code}/district",
        json={"name": "高税区", "anchor": [10, 10], "rows": 2, "cols": 2, "client_op_id": "d1"},
    )
    before = client.get(f"/api/saves/{code}").json()["metrics"]["happiness"]
    applied = client.post(
        f"/api/saves/{code}/district/policy",
        json={"did": 1, "policy": "green", "enabled": True, "client_op_id": "p1"},
    )
    assert applied.status_code == 200, applied.text
    after = client.get(f"/api/saves/{code}").json()["metrics"]["happiness"]
    assert after > before


def test_exclusive_policies_replace_each_other(client):
    code = _make(client)
    client.post(
        f"/api/saves/{code}/zone",
        json={"type": "res_low", "anchor": [10, 10], "rows": 2, "cols": 2, "client_op_id": "z1"},
    )
    client.post(
        f"/api/saves/{code}/district",
        json={"name": "切换区", "anchor": [10, 10], "rows": 2, "cols": 2, "client_op_id": "d1"},
    )
    client.post(
        f"/api/saves/{code}/district/policy",
        json={"did": 1, "policy": "tax_raise", "enabled": True, "client_op_id": "p1"},
    )
    client.post(
        f"/api/saves/{code}/district/policy",
        json={"did": 1, "policy": "tax_lower", "enabled": True, "client_op_id": "p2"},
    )
    districts = client.get(f"/api/saves/{code}").json()["districts"]
    assert districts[0]["policies"] == ["tax_lower"]


def test_unknown_policy_is_rejected(client):
    code = _make(client)
    client.post(
        f"/api/saves/{code}/district",
        json={"name": "区", "anchor": [10, 10], "rows": 1, "cols": 1, "client_op_id": "d1"},
    )
    bad = client.post(
        f"/api/saves/{code}/district/policy",
        json={"did": 1, "policy": "space_laser", "enabled": True, "client_op_id": "p9"},
    )
    assert bad.status_code in (400, 422)

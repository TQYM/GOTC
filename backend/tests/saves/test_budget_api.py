"""财政 REST：税率设置与贷款申请（对齐 C:S 的预算面板）。"""

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


def test_tax_rate_round_trips_and_shows_in_view(client: TestClient) -> None:
    code = create(client)
    response = client.post(f"/api/saves/{code}/tax", json={"service": "residential", "rate": 15})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["service"] == "residential"
    assert body["rate"] == 15
    assert body["view"]["budget"]["tax_rates"]["residential"] == 15


def test_tax_rate_is_clamped_to_one_and_twenty_nine(client: TestClient) -> None:
    code = create(client)
    low = client.post(f"/api/saves/{code}/tax", json={"service": "commercial", "rate": 0})
    assert low.status_code == 422  # 请求模型层就拒绝，不进业务
    high = client.post(f"/api/saves/{code}/tax", json={"service": "commercial", "rate": 99})
    assert high.status_code == 422


def test_unknown_service_is_rejected(client: TestClient) -> None:
    code = create(client)
    response = client.post(f"/api/saves/{code}/tax", json={"service": "space", "rate": 9})
    assert response.status_code == 400


def test_loan_credits_funds_and_adds_debt(client: TestClient) -> None:
    code = create(client)
    before = client.get(f"/api/saves/{code}").json()["metrics"]["funds"]
    response = client.post(f"/api/saves/{code}/loan", json={"amount": 200_000, "months": 24})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["principal"] == 200_000
    assert body["remaining"] == 200_000
    assert body["monthly_payment"] > 0
    after = client.get(f"/api/saves/{code}").json()
    assert after["metrics"]["funds"] == before + 200_000


def test_loan_rejects_out_of_range_amount(client: TestClient) -> None:
    code = create(client)
    too_small = client.post(f"/api/saves/{code}/loan", json={"amount": 1})
    assert too_small.status_code == 422
    too_big = client.post(f"/api/saves/{code}/loan", json={"amount": 99_000_000})
    assert too_big.status_code == 422


def test_sim_view_exposes_budget_block(client: TestClient) -> None:
    code = create(client)
    response = client.post(f"/api/saves/{code}/speed", json={"speed": 1})
    assert response.status_code == 200, response.text
    budget = response.json()["budget"]
    assert set(budget) >= {"funds", "day_income", "day_expenses", "debt", "tax_rates"}
    assert isinstance(budget["tax_rates"], dict)

"""REST 桩接口测试（PR-03 DoD）：02 §3 每个端点样例请求各通一次，错误码各命中一次。"""

import pytest
from fastapi.testclient import TestClient

from app.api import sessions as sessions_module
from app.api.sessions import registry as live_registry
from app.config import load_sim_config
from app.core.store import SessionRegistry
from app.main import app

SEED = 882314


@pytest.fixture()
def client():
    fresh = SessionRegistry(load_sim_config())
    sessions_module.registry = fresh
    try:
        yield TestClient(app)
    finally:
        sessions_module.registry = live_registry


def create(client: TestClient, seed: int | None = SEED) -> dict:
    body = {"seed": seed} if seed is not None else {}
    resp = client.post("/api/sessions", json=body)
    assert resp.status_code == 201
    return resp.json()


def find_cell(parcel: dict, terrain_value: str) -> list[int]:
    for r, row in enumerate(parcel["terrain"]):
        for c, t in enumerate(row):
            if t == terrain_value:
                return [r, c]
    raise AssertionError(f"parcel 中没有 {terrain_value}")


class TestCreateAndGet:
    def test_create_matches_contract(self, client):
        data = create(client)
        assert data["phase"] == "briefing"
        assert data["time_left_sec"] == 20
        assert data["funds"] == 5_000_000
        assert data["parcel"]["size"] == 48
        assert data["parcel"]["seed"] == SEED
        assert data["parcel"]["constraints"]["briefing"]

    def test_same_seed_same_parcel_via_api(self, client):
        a = create(client)["parcel"]
        b = create(client)["parcel"]
        assert a["terrain"] == b["terrain"]

    def test_get_state(self, client):
        sid = create(client)["session_id"]
        resp = client.get(f"/api/sessions/{sid}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["phase"] == "briefing"
        assert data["placements_count"] == 0
        assert data["tiles"] == []
        assert data["metrics"]["funds"] == 5_000_000

    def test_get_unknown_session(self, client):
        resp = client.get("/api/sessions/ses_nope")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "session_not_found"


class TestPlace:
    def _enter_build(self, client, sid):
        resp = client.post(f"/api/sessions/{sid}/advance")
        assert resp.status_code == 200
        assert resp.json() == {"phase": "build", "time_left_sec": 900}

    def test_place_happy_path(self, client):
        sid = create(client)["session_id"]
        self._enter_build(client, sid)
        parcel = client.get(f"/api/sessions/{sid}").json()["parcel"]
        anchor = find_cell(parcel, "flat")
        resp = client.post(f"/api/sessions/{sid}/place", json={"type": "res_mid", "anchor": anchor})
        assert resp.status_code == 200
        data = resp.json()
        assert data["tile"]["type"] == "res_mid"
        assert data["tile"]["anchor"] == anchor
        assert data["metrics"]["funds"] == 5_000_000 - 220_000
        # 02 §2.2：delta 只带变化字段的新值
        assert data["metrics_diff"]["delta"]["funds"] == 5_000_000 - 220_000
        assert data["metrics_diff"]["delta"]["population"] == 855
        assert data["funds_after"] == 5_000_000 - 220_000

    def test_place_on_river_rejected(self, client):
        sid = create(client)["session_id"]
        self._enter_build(client, sid)
        parcel = client.get(f"/api/sessions/{sid}").json()["parcel"]
        anchor = find_cell(parcel, "river")
        resp = client.post(f"/api/sessions/{sid}/place", json={"type": "res_mid", "anchor": anchor})
        assert resp.status_code == 400
        err = resp.json()["error"]
        assert err["code"] == "invalid_placement"
        assert err["details"]["cells"]
        # 02 §3.3：失败响应附最新 metrics 与 funds_after
        assert err["details"]["funds_after"] == 5_000_000
        assert err["details"]["metrics"]["population"] == 0

    def test_place_out_of_bounds(self, client):
        sid = create(client)["session_id"]
        self._enter_build(client, sid)
        resp = client.post(
            f"/api/sessions/{sid}/place", json={"type": "com_cbd", "anchor": [47, 47]}
        )
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "invalid_placement"

    def test_place_occupied_cell(self, client):
        sid = create(client)["session_id"]
        self._enter_build(client, sid)
        parcel = client.get(f"/api/sessions/{sid}").json()["parcel"]
        anchor = find_cell(parcel, "flat")
        payload = {"type": "res_mid", "anchor": anchor}
        first = client.post(f"/api/sessions/{sid}/place", json=payload)
        assert first.status_code == 200
        second = client.post(f"/api/sessions/{sid}/place", json=payload)
        assert second.status_code == 409
        assert second.json()["error"]["code"] == "cell_occupied"

    def test_place_in_briefing_phase(self, client):
        sid = create(client)["session_id"]
        parcel = client.get(f"/api/sessions/{sid}").json()["parcel"]
        anchor = find_cell(parcel, "flat")
        resp = client.post(f"/api/sessions/{sid}/place", json={"type": "res_mid", "anchor": anchor})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "invalid_phase"

    def test_place_insufficient_funds(self, client):
        sid = create(client)["session_id"]
        self._enter_build(client, sid)
        parcel = client.get(f"/api/sessions/{sid}").json()["parcel"]

        def find_block(size: int, exclude: set[tuple[int, int]]) -> list[int]:
            for r in range(parcel["size"] - size + 1):
                for c in range(parcel["size"] - size + 1):
                    cells = {(r + dr, c + dc) for dr in range(size) for dc in range(size)}
                    if cells & exclude:
                        continue
                    if all(
                        parcel["terrain"][rr][cc] in ("flat", "hill", "forest") for rr, cc in cells
                    ):
                        return [r, c]
            raise AssertionError("找不到可用空地")

        heavy = {"type": "ind_heavy", "anchor": find_block(3, set())}
        resp = client.post(f"/api/sessions/{sid}/place", json=heavy)
        assert resp.status_code == 200
        occupied = {(rr, cc) for rr, cc in resp.json()["tile"]["cells"]}
        # 余 1,000,000，另一处商务中心需 2,200,000 → 402
        cbd = {"type": "com_cbd", "anchor": find_block(2, occupied)}
        resp2 = client.post(f"/api/sessions/{sid}/place", json=cbd)
        assert resp2.status_code == 402
        assert resp2.json()["error"]["code"] == "insufficient_funds"

    def test_place_invalid_payload(self, client):
        sid = create(client)["session_id"]
        resp = client.post(f"/api/sessions/{sid}/place", json={"anchor": [1, 1]})
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "invalid_payload"


class TestRemove:
    def test_remove_happy_path(self, client):
        sid = create(client)["session_id"]
        client.post(f"/api/sessions/{sid}/advance")
        parcel = client.get(f"/api/sessions/{sid}").json()["parcel"]
        anchor = find_cell(parcel, "flat")
        placed = client.post(
            f"/api/sessions/{sid}/place", json={"type": "res_mid", "anchor": anchor}
        ).json()
        refund = -(-220_000 * 30 // 100)  # ceil(220000×0.3)=66000
        resp = client.post(f"/api/sessions/{sid}/remove", json={"tile_id": placed["tile"]["id"]})
        assert resp.status_code == 200
        data = resp.json()
        assert data["tile"]["id"] == placed["tile"]["id"]
        assert data["funds_after"] == 5_000_000 - 220_000 + refund
        assert data["metrics_diff"]["delta"]["funds"] == 5_000_000 - 220_000 + refund
        assert data["metrics_diff"]["delta"]["population"] == 0
        state = client.get(f"/api/sessions/{sid}").json()
        assert state["tiles"] == []
        assert state["placements_count"] == 1

    def test_remove_unknown_tile(self, client):
        sid = create(client)["session_id"]
        client.post(f"/api/sessions/{sid}/advance")
        resp = client.post(f"/api/sessions/{sid}/remove", json={"tile_id": "tile_nope"})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "invalid_placement"


class TestAdvanceFinalize:
    def test_advance_twice_rejected(self, client):
        sid = create(client)["session_id"]
        assert client.post(f"/api/sessions/{sid}/advance").status_code == 200
        resp = client.post(f"/api/sessions/{sid}/advance")
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "invalid_phase"

    def test_finalize_from_build(self, client):
        sid = create(client)["session_id"]
        client.post(f"/api/sessions/{sid}/advance")
        resp = client.post(f"/api/sessions/{sid}/finalize")
        assert resp.status_code == 200
        data = resp.json()
        assert data["phase"] == "locked"
        assert len(data["projection"]) == 10
        assert set(data["scores"]) == {"population", "balance", "green", "traffic", "happiness"}
        assert data["report"]["overview"]
        assert data["city_name"]

    def test_finalize_idempotent(self, client):
        sid = create(client)["session_id"]
        client.post(f"/api/sessions/{sid}/advance")
        first = client.post(f"/api/sessions/{sid}/finalize").json()
        second = client.post(f"/api/sessions/{sid}/finalize")
        assert second.status_code == 200
        assert second.json() == first

    def test_finalize_in_briefing_rejected(self, client):
        sid = create(client)["session_id"]
        resp = client.post(f"/api/sessions/{sid}/finalize")
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "invalid_phase"

    def test_place_after_finalize_rejected(self, client):
        sid = create(client)["session_id"]
        client.post(f"/api/sessions/{sid}/advance")
        client.post(f"/api/sessions/{sid}/finalize")
        parcel = create(client)["parcel"]
        anchor = find_cell(parcel, "flat")
        resp = client.post(f"/api/sessions/{sid}/place", json={"type": "res_mid", "anchor": anchor})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "invalid_phase"


class TestRestart:
    def test_restart_with_seed_recreates_parcel(self, client):
        sid = create(client)["session_id"]
        resp = client.post(f"/api/sessions/{sid}/restart", json={"seed": SEED})
        assert resp.status_code == 201
        data = resp.json()
        assert data["session_id"] != sid
        assert data["parcel"]["seed"] == SEED
        assert data["parcel"]["terrain"] == create(client)["parcel"]["terrain"]


class TestStream:
    def test_stream_emits_snapshot_on_connect(self, client):
        """PR-13 真流：新连接先发 phase_change + 全量 tick 快照（读到即关，不再读全流）。"""
        sid = create(client)["session_id"]
        seen = []
        with client.stream("GET", f"/api/sessions/{sid}/stream") as resp:
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")
            for line in resp.iter_lines():
                if line.startswith("event:"):
                    seen.append(line.split(":", 1)[1].strip())
                if len(seen) >= 2:
                    break
        assert seen[:2] == ["phase_change", "tick"]

    def test_stream_unknown_session(self, client):
        resp = client.get("/api/sessions/ses_nope/stream")
        assert resp.status_code == 404


class TestHealthz:
    def test_healthz(self, client):
        resp = client.get("/healthz")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "sessions" in data

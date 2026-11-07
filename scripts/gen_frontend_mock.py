"""生成前端 mock 会话（frontend/src/lib/mock/session-882314.json）。

用后端真实生成器 + REST 桩跑一局（seed=882314），摆满全部 14 种区块，
导出 02 §3.2 GET 会话响应。契约或生成器变化后重跑即可：

    cd backend && python ../scripts/gen_frontend_mock.py
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.sessions import registry
from app.main import app

SEED = 882314
OUT = Path(__file__).resolve().parents[1] / "frontend/src/lib/mock/session-882314.json"
SHOWCASE = [
    "res_low", "res_mid", "res_high", "com_shop", "com_cbd", "ind_light", "ind_heavy",
    "green_park", "green_plaza", "edu_school", "med_clinic", "trans_metro", "trans_road",
    "res_mid", "res_high", "res_low", "com_shop", "green_park", "res_mid", "res_high",
]


def main() -> None:
    client = TestClient(app)
    created = client.post("/api/sessions", json={"seed": SEED}).json()
    sid = created["session_id"]
    client.post(f"/api/sessions/{sid}/advance").raise_for_status()
    registry.get(sid).funds = 60_000_000  # 展示用：资金足够摆满 14 种区块
    terrain = created["parcel"]["terrain"]
    size = len(terrain)

    def place(tile_type: str, r: int, c: int) -> bool:
        body: dict = {"type": tile_type, "anchor": [r, c]}
        if tile_type == "util_bridge":
            body["orientation"] = "horizontal"  # 02 §2.3：桥必须带 orientation
        resp = client.post(f"/api/sessions/{sid}/place", json=body)
        return resp.status_code == 200

    spots = iter(
        sorted(
            ((r, c) for r in range(6, size - 6, 3) for c in range(6, size - 6, 3)),
            key=lambda p: abs(p[0] - 24) + abs(p[1] - 24),
        )
    )
    for tile_type in SHOWCASE:
        for r, c in spots:
            if place(tile_type, r, c):
                break
    for c in range(10, 22):
        place("trans_road", 30, c)
    for r in range(14, 40):
        if "river" in terrain[r] and place("util_bridge", r, terrain[r].index("river")):
            break

    state = client.get(f"/api/sessions/{sid}").json()
    state["session_id"] = "ses_mock"
    OUT.write_text(json.dumps(state, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({len(state['tiles'])} tiles)")


if __name__ == "__main__":
    main()

"""离线数据包加载；运行时绝不访问在线 GIS 服务。"""

import json
import secrets
from pathlib import Path

from app.config import SimConfig
from app.contracts.asset import ExistingAsset
from app.contracts.errors import ErrorCode
from app.contracts.parcel import Parcel
from app.core.city import CityState
from app.core.errors import GameError
from app.sim.generator import generate_parcel


def load_parcel(
    parcel_id: str, seed: int | None, data_dir: str | Path, config: SimConfig
) -> tuple[Parcel, dict[str, ExistingAsset]]:
    if parcel_id == "sandbox":
        return generate_parcel(seed if seed is not None else secrets.randbits(31), config), {}
    if parcel_id != "beijing_cbd":
        raise GameError(ErrorCode.INVALID_PAYLOAD, "未知 parcel_id", {"parcel_id": parcel_id})
    path = Path(data_dir) / parcel_id
    try:
        parcel = Parcel.model_validate(json.loads((path / "parcel.json").read_text("utf-8")))
        raw_buildings = json.loads((path / "buildings.json").read_text("utf-8"))
        assets = [
            ExistingAsset.model_validate(item)
            for chunk in raw_buildings.get("chunks", {}).values()
            for item in chunk
        ]
    except (OSError, ValueError) as exc:
        raise GameError(
            ErrorCode.INTERNAL_ERROR,
            f"真实片区数据包不可用: {parcel_id}",
            {"path": str(path)},
        ) from exc
    parcel = parcel.model_copy(
        update={
            "parcel_id": parcel_id,
            "seed": seed if seed is not None else parcel.seed,
            "buildings_url": f"/static/parcels/{parcel_id}/buildings.json",
            "network_url": f"/static/parcels/{parcel_id}/network.json",
        }
    )
    return parcel, {asset.asset_id: asset for asset in assets}


def load_city(
    *,
    save_id: str,
    city_code: str,
    name: str,
    parcel_id: str,
    seed: int | None,
    data_dir: str | Path,
    config: SimConfig,
) -> CityState:
    parcel, assets = load_parcel(parcel_id, seed, data_dir, config)
    return CityState(
        session_id=save_id,
        city_code=city_code,
        name=name,
        parcel=parcel,
        config=config,
        funds=config.economy.initial_funds,
        existing_assets=assets,
    )

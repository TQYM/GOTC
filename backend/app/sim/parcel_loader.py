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
    path = Path(data_dir) / parcel_id
    if not (path / "parcel.json").is_file():
        raise GameError(ErrorCode.INVALID_PAYLOAD, "未知 parcel_id", {"parcel_id": parcel_id})
    try:
        parcel = Parcel.model_validate(json.loads((path / "parcel.json").read_text("utf-8")))
        raw_buildings = json.loads((path / "buildings.json").read_text("utf-8"))
        raw_chunks = raw_buildings.get("chunks")
        if raw_chunks is None:
            raw_chunks = {"flat": raw_buildings.get("buildings", [])}
        # 数据包只给 category / levels / footprint，没有人口与岗位。
        # 按「楼层占比」把北京实际数字摊到每栋：
        #   常住人口 21,858,440（北京统计局 2023 年末）÷ 住宅总楼层 120,928 ≈ 181 人/层
        #   就业岗位 13,000,000（北京统计年鉴）÷ 岗位总楼层 31,944 ≈ 407 岗/层
        # 这样开局的人口/岗位直接等于北京现状，而不是从 0 长起。
        PEOPLE_PER_FLOOR = 181
        JOBS_PER_FLOOR = 407
        assets = []
        for chunk in raw_chunks.values():
            for item in chunk:
                levels = int(item.get("levels") or 1)
                category = item.get("category")
                if category == "residential":
                    extra = {"population": levels * PEOPLE_PER_FLOOR, "jobs": 0}
                elif category in ("workplace", "industrial"):
                    extra = {"population": 0, "jobs": levels * JOBS_PER_FLOOR}
                else:
                    extra = {"population": 0, "jobs": 0}
                assets.append(ExistingAsset.model_validate({**item, **extra}))
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

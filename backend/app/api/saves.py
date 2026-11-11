"""saves v2 REST 与 SSE 路由。"""

import asyncio
import json
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.contracts.save import (
    HistoricalRequest,
    RelocateRequest,
    RenameRequest,
    CityPolicyRequest,
    TransitDeleteRequest,
    TransitLineRequest,
    TransitPriceRequest,
    TransitStopRequest,
    CreateSaveRequest,
    MentorAccepted,
    OperationRequest,
    OperationResult,
    ProjectionResult,
    ProjectRequest,
    RedevelopRequest,
    ReportList,
    ReportResult,
    SavePlaceRequest,
    SaveRemoveRequest,
    DistrictPolicyRequest,
    DistrictRequest,
    ZoneRequest,
    SaveState,
)
from app.core.service import SaveRuntime, SaveService

router = APIRouter(prefix="/api/saves", tags=["saves"])
SSE_HEARTBEAT_SEC = 15.0
service = SaveService.from_settings()


class SpeedRequest(BaseModel):
    """速度档：0 暂停 / 1 1x / 2 2x / 3 3x（实际 4x）。"""

    speed: int = Field(ge=0, le=3)


class TaxRequest(BaseModel):
    """税率（百分点，C:S 区间 1..29）。"""

    service: str
    rate: int = Field(ge=1, le=29)


class LoanRequest(BaseModel):
    """贷款：本金 / 期数 / 年化基点。"""

    amount: int = Field(ge=10_000, le=20_000_000)
    months: int = Field(default=60, ge=12, le=120)
    rate_bp: int = Field(default=500, ge=0, le=3000)


def get_service() -> SaveService:
    return service


async def runtime_of(
    city_code: str, svc: Annotated[SaveService, Depends(get_service)]
) -> SaveRuntime:
    return await svc._runtime(city_code)


@router.post("", status_code=201, response_model=SaveState)
async def create_save(
    body: Annotated[CreateSaveRequest | None, Body()] = None,
) -> SaveState:
    return await service.create(body or CreateSaveRequest())


@router.get("/{city_code}", response_model=SaveState)
async def get_save(
    city_code: str, svc: Annotated[SaveService, Depends(get_service)]
) -> SaveState:
    return await svc.get(city_code)


@router.post("/{city_code}/start", response_model=SaveState)
async def start_save(
    city_code: str, svc: Annotated[SaveService, Depends(get_service)]
) -> SaveState:
    return await svc.start(city_code)



@router.post("/{city_code}/place", response_model=OperationResult)
async def place(
    city_code: str, body: SavePlaceRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> OperationResult:
    payload: dict[str, Any] = {"type": body.type.value, "anchor": body.anchor}
    if body.orientation is not None:
        payload["orientation"] = body.orientation
    return await svc.apply(
        city_code, "place", client_op_id=body.client_op_id, payload=payload
    )


@router.post("/{city_code}/zone", response_model=OperationResult)
async def zone(
    city_code: str, body: ZoneRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> OperationResult:
    return await svc.zone(
        city_code,
        tile_type=body.type.value,
        anchor=body.anchor,
        rows=body.rows,
        cols=body.cols,
        client_op_id=body.client_op_id,
    )


@router.post("/{city_code}/rename")
async def rename_tile(city_code: str, req: RenameRequest) -> OperationResult:
    return await service.rename_tile(
        city_code, tile_id=req.tile_id, name=req.name, client_op_id=req.client_op_id
    )


@router.post("/{city_code}/relocate")
async def relocate_tile(city_code: str, req: RelocateRequest) -> OperationResult:
    return await service.relocate_tile(
        city_code, tile_id=req.tile_id, anchor=req.anchor, client_op_id=req.client_op_id
    )


@router.post("/{city_code}/historical")
async def set_historical(city_code: str, req: HistoricalRequest) -> OperationResult:
    return await service.set_historical(
        city_code, tile_id=req.tile_id, historical=req.historical, client_op_id=req.client_op_id
    )


@router.post("/{city_code}/policy")
async def set_city_policy(city_code: str, req: CityPolicyRequest) -> OperationResult:
    return await service.set_city_policy(
        city_code, policy=req.policy, enabled=req.enabled, client_op_id=req.client_op_id
    )


@router.post("/{city_code}/district")
async def create_district(
    city_code: str, body: DistrictRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> dict:
    result = await svc.create_district(
        city_code,
        name=body.name,
        anchor=body.anchor,
        rows=body.rows,
        cols=body.cols,
        client_op_id=body.client_op_id,
    )
    return result.model_dump(mode="json")


@router.post("/{city_code}/district/policy")
async def set_district_policy(
    city_code: str, body: DistrictPolicyRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> dict:
    return await svc.set_district_policy(
        city_code,
        did=body.did,
        policy=body.policy,
        enabled=body.enabled,
        client_op_id=body.client_op_id,
    )


@router.post("/{city_code}/transit")
async def create_transit_line(
    city_code: str, body: TransitLineRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> dict:
    return await svc.create_transit_line(
        city_code,
        name=body.name,
        kind=body.kind,
        stops=body.stops,
        color=body.color,
        client_op_id=body.client_op_id,
    )


@router.post("/{city_code}/transit/stop")
async def add_transit_stop(
    city_code: str, body: TransitStopRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> dict:
    return await svc.add_transit_stop(
        city_code,
        lid=body.lid,
        tile_id=body.tile_id,
        index=body.index,
        client_op_id=body.client_op_id,
    )


@router.post("/{city_code}/transit/price")
async def set_transit_price(
    city_code: str, body: TransitPriceRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> dict:
    return await svc.set_transit_price(
        city_code, lid=body.lid, price=body.price, client_op_id=body.client_op_id
    )


@router.post("/{city_code}/transit/{lid}/delete")
async def delete_transit_line(
    city_code: str, lid: int, body: TransitDeleteRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> dict:
    return await svc.delete_transit_line(
        city_code, lid=lid, client_op_id=body.client_op_id
    )


@router.post("/{city_code}/remove", response_model=OperationResult)
async def remove(
    city_code: str, body: SaveRemoveRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> OperationResult:
    return await svc.apply(
        city_code,
        "remove",
        client_op_id=body.client_op_id,
        payload={"tile_id": body.tile_id},
    )


@router.post("/{city_code}/redevelop", response_model=OperationResult)
async def redevelop(
    city_code: str, body: RedevelopRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> OperationResult:
    return await svc.apply(
        city_code,
        "redevelop",
        client_op_id=body.client_op_id,
        payload={"anchor": body.anchor},
    )


@router.post("/{city_code}/advance", response_model=OperationResult)
async def advance(
    city_code: str, body: OperationRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> OperationResult:
    return await svc.apply(city_code, "advance", client_op_id=body.client_op_id, payload={})


@router.post("/{city_code}/speed")
async def set_speed(
    city_code: str, body: SpeedRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> dict[str, Any]:
    return await svc.set_speed(city_code, body.speed)


@router.post("/{city_code}/tax")
async def set_tax(
    city_code: str, body: TaxRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> dict[str, Any]:
    return await svc.set_tax_rate(city_code, body.service, body.rate)


@router.post("/{city_code}/loan")
async def take_loan(
    city_code: str, body: LoanRequest,
    svc: Annotated[SaveService, Depends(get_service)]
) -> dict[str, Any]:
    return await svc.take_loan(city_code, body.amount, body.months, body.rate_bp)


@router.post("/{city_code}/project", response_model=ProjectionResult)
async def project(
    city_code: str,
    svc: Annotated[SaveService, Depends(get_service)],
    body: Annotated[ProjectRequest | None, Body()] = None,
) -> ProjectionResult:
    return await svc.project(city_code, (body or ProjectRequest()).years)


@router.post("/{city_code}/report", response_model=ReportResult)
async def report(
    city_code: str, svc: Annotated[SaveService, Depends(get_service)]
) -> ReportResult:
    return await svc.report(city_code)


@router.get("/{city_code}/reports", response_model=ReportList)
async def reports(
    city_code: str, svc: Annotated[SaveService, Depends(get_service)]
) -> ReportList:
    return ReportList(reports=await svc.reports(city_code))


@router.post("/{city_code}/mentor", status_code=202, response_model=MentorAccepted)
async def mentor(
    city_code: str, svc: Annotated[SaveService, Depends(get_service)]
) -> MentorAccepted:
    await svc.mentor(city_code)
    return MentorAccepted()


@router.get("/{city_code}/events")
async def events(
    city_code: str, request: Request,
    svc: Annotated[SaveService, Depends(get_service)]
) -> EventSourceResponse:
    runtime = await svc._runtime(city_code)
    last_header = request.headers.get("last-event-id")
    try:
        last_id = int(last_header) if last_header is not None else None
    except ValueError:
        last_id = 0
    return EventSourceResponse(_event_stream(runtime, svc, last_id))


async def _event_stream(runtime: SaveRuntime, svc: SaveService, last_id: int | None):
    """先订阅再补发，cutoff 去重；无法可靠补发时发送全量 snapshot。"""
    broadcaster = runtime.broadcaster
    queue = broadcaster.subscribe()
    cutoff = broadcaster.latest_id
    try:
        replay = None if last_id is None else broadcaster.replay_after(last_id)
        if (
            replay is None
            or (last_id is not None and last_id > cutoff)
            or (last_id is not None and last_id < cutoff and not replay)
        ):
            async with runtime.lock:
                snapshot = svc._state_view(runtime).model_dump(mode="json")
            yield {
                "id": str(cutoff),
                "event": "snapshot",
                "data": json.dumps(snapshot, ensure_ascii=False),
            }
        elif replay:
            for entry in replay:
                if entry.id <= cutoff:
                    yield entry.sse_frame()
        while True:
            try:
                entry = await asyncio.wait_for(queue.get(), timeout=SSE_HEARTBEAT_SEC)
            except TimeoutError:
                yield {"comment": "heartbeat"}
                continue
            if entry.id > cutoff:
                yield entry.sse_frame()
    finally:
        broadcaster.unsubscribe(queue)

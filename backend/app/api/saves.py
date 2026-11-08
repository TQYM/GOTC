"""saves v2 REST 与 SSE 路由。"""

import asyncio
import json
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Request
from sse_starlette.sse import EventSourceResponse

from app.contracts.save import (
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
    SaveState,
)
from app.core.service import SaveRuntime, SaveService

router = APIRouter(prefix="/api/saves", tags=["saves"])
SSE_HEARTBEAT_SEC = 15.0
service = SaveService.from_settings()


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

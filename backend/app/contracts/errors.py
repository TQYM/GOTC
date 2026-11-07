"""错误协议（02 §1）：统一错误信封 + 错误码 + HTTP 状态映射。"""

from enum import StrEnum
from typing import Any

from pydantic import BaseModel


class ErrorCode(StrEnum):
    INVALID_PLACEMENT = "invalid_placement"
    INVALID_PHASE = "invalid_phase"
    INSUFFICIENT_FUNDS = "insufficient_funds"
    SESSION_NOT_FOUND = "session_not_found"
    CELL_OCCUPIED = "cell_occupied"
    INVALID_PAYLOAD = "invalid_payload"
    INTERNAL_ERROR = "internal_error"


class ErrorBody(BaseModel):
    code: ErrorCode
    message: str
    details: dict[str, Any] | None = None


class ErrorEnvelope(BaseModel):
    error: ErrorBody


# 02 §1 错误表：错误码 → HTTP 状态
HTTP_STATUS_BY_CODE: dict[ErrorCode, int] = {
    ErrorCode.INVALID_PLACEMENT: 400,
    ErrorCode.INVALID_PHASE: 400,
    ErrorCode.INSUFFICIENT_FUNDS: 402,
    ErrorCode.SESSION_NOT_FOUND: 404,
    ErrorCode.CELL_OCCUPIED: 409,
    ErrorCode.INVALID_PAYLOAD: 422,
    ErrorCode.INTERNAL_ERROR: 500,
}

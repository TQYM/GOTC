"""领域错误（02 §1）：携带契约错误码的异常，由 API 层统一装信封。"""

from typing import Any

from app.contracts.errors import ErrorCode


class GameError(Exception):
    def __init__(
        self,
        code: ErrorCode,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details

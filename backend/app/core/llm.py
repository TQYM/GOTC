"""OpenAI 兼容 LLM 抽象（06 §2）：narrate 与具体模型之间的唯一缝隙。

- 统一 chat/completions 形状；三角色可路由不同模型（04 §7）。
- 超时：news/citizen 8s、mentor/report 20s；信号量兜并发，超队列直接抛 LLMOverloaded → 模板降级。
- 任何异常都以 LLMError 子类抛出，绝不冒泡原始 httpx 异常到 api 层。
"""

import asyncio
import json
import logging
from typing import Any

import httpx

from app.config import Settings

log = logging.getLogger(__name__)

ROLE_NEWS = "news"
ROLE_CITIZEN = "citizen"
ROLE_MENTOR = "mentor"
ROLE_REPORT = "report"  # 报告复用 mentor 路由与长超时

ROLE_TEMPERATURE = {ROLE_NEWS: 0.9, ROLE_CITIZEN: 0.9, ROLE_MENTOR: 0.3, ROLE_REPORT: 0.3}


class LLMError(Exception):
    """LLM 调用失败的统一基类。"""


class LLMUnavailable(LLMError):
    """未配置 key / 端点，直接走模板。"""


class LLMOverloaded(LLMError):
    """并发已满，超队列丢弃并降级（04 §7）。"""


class LLMTimeout(LLMError):
    """8s/20s 超时。"""


class LLMResponseError(LLMError):
    """HTTP 非 200 或响应形状异常。"""


class LLMParseError(LLMError):
    """JSON 解析重试 1 次后仍失败（04 §5）。"""


class LLMClient:
    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._settings = settings
        self._semaphore = asyncio.Semaphore(settings.llm_max_concurrent)
        self._transport = transport  # 测试注入 MockTransport

    @property
    def available(self) -> bool:
        return bool(self._settings.llm_api_key)

    def model_for(self, role: str) -> str:
        override = {
            ROLE_NEWS: self._settings.llm_model_news,
            ROLE_CITIZEN: self._settings.llm_model_citizen,
            ROLE_MENTOR: self._settings.llm_model_mentor,
            ROLE_REPORT: self._settings.llm_model_mentor,
        }.get(role)
        return override or self._settings.llm_model

    async def chat(
        self,
        role: str,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
    ) -> str:
        """发一次 chat/completions，返回文本内容。所有失败抛 LLMError 子类。"""
        if not self.available:
            raise LLMUnavailable("未配置 CITY20_LLM_API_KEY，走模板降级")
        if self._semaphore.locked():
            raise LLMOverloaded("LLM 并发已满，丢弃该条并降级")
        long_timeout = role in (ROLE_MENTOR, ROLE_REPORT)
        timeout = (
            self._settings.llm_timeout_long if long_timeout else self._settings.llm_timeout_short
        )
        payload = {
            "model": self.model_for(role),
            "messages": messages,
            "temperature": ROLE_TEMPERATURE.get(role, 0.7) if temperature is None else temperature,
        }
        async with self._semaphore:
            try:
                async with httpx.AsyncClient(
                    base_url=self._settings.llm_base_url,
                    timeout=timeout,
                    transport=self._transport,
                ) as client:
                    resp = await client.post(
                        "/chat/completions",
                        json=payload,
                        headers={"Authorization": f"Bearer {self._settings.llm_api_key}"},
                    )
            except httpx.TimeoutException as exc:
                raise LLMTimeout(f"{role} 调用超时（{timeout}s）") from exc
            except httpx.HTTPError as exc:
                raise LLMResponseError(f"{role} 网络错误：{exc}") from exc
        if resp.status_code != 200:
            raise LLMResponseError(f"{role} HTTP {resp.status_code}: {resp.text[:200]}")
        try:
            data = resp.json()
            return str(data["choices"][0]["message"]["content"])
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMResponseError(f"{role} 响应形状异常") from exc

    async def chat_json(
        self,
        role: str,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
    ) -> dict[str, Any]:
        """04 §5：按 JSON 解析，失败重试 1 次（附严格 JSON 提醒），再败抛 LLMParseError。"""
        content = await self.chat(role, messages, temperature=temperature)
        try:
            return _parse_json_object(content)
        except ValueError:
            log.warning("%s 首次输出无法解析，重试一次", role)
        retry = messages + [
            {"role": "user", "content": "上次输出无法解析，请严格输出 JSON，不要任何其他文字。"}
        ]
        content = await self.chat(role, retry, temperature=temperature)
        try:
            return _parse_json_object(content)
        except ValueError as exc:
            raise LLMParseError(f"{role} 两次输出均非合法 JSON，丢弃该条") from exc


def _parse_json_object(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):  # 容错：剥掉代码围栏再按严格 JSON 解析
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    result = json.loads(text)
    if not isinstance(result, dict):
        raise ValueError("顶层必须是 JSON object")
    return result

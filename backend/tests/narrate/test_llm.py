"""LLM 抽象层测试（PR-09）：路由/超时/并发/解析重试/降级。

真实 HTTP 由 httpx.MockTransport 替代，验证请求形状与错误链路；
配 key 的真实冒烟见 scripts/llm_smoke.py（现场执行）。
"""

import asyncio
import json

import httpx
import pytest

from app.config import Settings
from app.core.llm import (
    LLMClient,
    LLMOverloaded,
    LLMParseError,
    LLMResponseError,
    LLMTimeout,
    LLMUnavailable,
)


def make_settings(**kwargs) -> Settings:
    return Settings(llm_api_key="test-key", **kwargs)


def ok_transport(payload: dict, capture: list | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if capture is not None:
            capture.append(json.loads(request.content))
        return httpx.Response(200, json=payload)

    return httpx.MockTransport(handler)


def chat_payload(text: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": text}}]}


def run(coro):
    return asyncio.run(coro)


class TestAvailability:
    def test_no_key_raises_unavailable(self):
        client = LLMClient(Settings())
        assert not client.available
        with pytest.raises(LLMUnavailable):
            run(client.chat("news", [{"role": "user", "content": "hi"}]))

    def test_routing_per_role(self):
        settings = make_settings(llm_model_news="qwen-news", llm_model_mentor="kimi-mentor")
        client = LLMClient(settings)
        assert client.model_for("news") == "qwen-news"
        assert client.model_for("mentor") == "kimi-mentor"
        assert client.model_for("report") == "kimi-mentor"  # 报告复用导师路由
        assert client.model_for("citizen") == "deepseek-chat"


class TestChat:
    def test_request_shape_and_content(self):
        capture: list[dict] = []
        client = LLMClient(
            make_settings(), transport=ok_transport(chat_payload('{"headline":"x"}'), capture)
        )
        content = run(client.chat("news", [{"role": "user", "content": "hi"}]))
        assert content == '{"headline":"x"}'
        assert capture[0]["model"] == "deepseek-chat"
        assert capture[0]["temperature"] == 0.9  # 新闻高温（04 §5）

    def test_mentor_low_temperature(self):
        capture: list[dict] = []
        client = LLMClient(make_settings(), transport=ok_transport(chat_payload("{}"), capture))
        run(client.chat("mentor", []))
        assert capture[0]["temperature"] == 0.3

    def test_http_error(self):
        transport = httpx.MockTransport(lambda req: httpx.Response(500, text="boom"))
        client = LLMClient(make_settings(), transport=transport)
        with pytest.raises(LLMResponseError):
            run(client.chat("news", []))

    def test_timeout(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("slow")

        client = LLMClient(make_settings(), transport=httpx.MockTransport(handler))
        with pytest.raises(LLMTimeout):
            run(client.chat("citizen", []))

    def test_overload_drops(self):
        client = LLMClient(make_settings(llm_max_concurrent=1))
        client._semaphore._value = 0  # 模拟并发占满：超队列直接丢弃
        with pytest.raises(LLMOverloaded):
            run(client.chat("news", []))


class TestChatJson:
    def test_parse_ok(self):
        client = LLMClient(
            make_settings(), transport=ok_transport(chat_payload('{"headline":"绿地率上升"}'))
        )
        result = run(client.chat_json("news", []))
        assert result["headline"] == "绿地率上升"

    def test_retry_once_then_success(self):
        calls = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            text = "not json" if calls["n"] == 1 else '{"ok": true}'
            return httpx.Response(200, json=chat_payload(text))

        client = LLMClient(make_settings(), transport=httpx.MockTransport(handler))
        result = run(client.chat_json("news", [{"role": "user", "content": "hi"}]))
        assert result == {"ok": True}
        assert calls["n"] == 2

    def test_retry_twice_fails(self):
        client = LLMClient(make_settings(), transport=ok_transport(chat_payload("still not json")))
        with pytest.raises(LLMParseError):
            run(client.chat_json("news", []))

    def test_non_dict_rejected(self):
        client = LLMClient(make_settings(), transport=ok_transport(chat_payload("[1,2]")))
        with pytest.raises(LLMParseError):
            run(client.chat_json("news", []))

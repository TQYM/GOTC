"""真实 key 冒烟（04 §7 评测）：三角色各发一次真实请求并打印样例。

用法：
  export CITY20_LLM_API_KEY=sk-...
  python scripts/llm_smoke.py            # 默认 DeepSeek
  CITY20_LLM_BASE_URL=http://localhost:11434/v1 CITY20_LLM_MODEL=qwen2.5 \
      python scripts/llm_smoke.py        # 本地 Ollama 兜底

输出脱敏（仅城市虚构数据），供 PR/比赛演示附样例。无 key 时打印降级提示。
"""

import asyncio
import json

from app.config import Settings
from app.core.llm import LLMClient, LLMError

PROMPTS = {
    "news": (
        "你是城市数据电台主播。根据指标变化输出 JSON："
        "{\"headline\":\"≤20字\",\"body\":\"≤80字\",\"severity\":\"info\"}。"
        "数据：绿地率 0.18→0.26，原因：新建 2 座公园。只输出 JSON。"
    ),
    "citizen": (
        "你是退休教师陈伯，关心绿地与安静。输出 JSON："
        "{\"text\":\"≤60字口语化带emoji\",\"sentiment\":\"happy\",\"topic\":\"green\"}。"
        "数据：绿地率升至 0.26。只输出 JSON。"
    ),
    "mentor": (
        "你是注册城乡规划师。输出 JSON："
        "{\"comment\":\"≤120字\",\"theory_refs\":[\"green_network\"],\"severity\":\"warning\"}。"
        "数据：绿地率 0.26、拥堵 0.71、职住比 1.4。只输出 JSON。"
    ),
}


async def main() -> None:
    settings = Settings()
    client = LLMClient(settings)
    if not client.available:
        print("未配置 CITY20_LLM_API_KEY：游戏走模板降级链路（这本身是验收项）。")
        return
    print(f"endpoint={settings.llm_base_url} model={settings.llm_model}")
    for role, prompt in PROMPTS.items():
        try:
            result = await client.chat_json(role, [{"role": "user", "content": prompt}])
            print(f"\n[{role}] 路由模型={client.model_for(role)}")
            print(json.dumps(result, ensure_ascii=False, indent=2))
        except LLMError as exc:
            print(f"\n[{role}] 降级：{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    asyncio.run(main())

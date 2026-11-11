"""天气与季节（对齐 C:S 的 WeatherManager：云量 / 降雨 / 雾 / 温度 / 极光）。

C:S 的天气是插值系统：`m_currentCloud` / `m_targetCloud` 成对，每帧向目标靠拢。
CITY20 简化成「按游戏日离散生成 + 对交通/污染/维护费的乘数」，理由：
- 全年 3600 帧、每天 10 帧，逐帧插值对 10 帧一天太细；
- 玩家能感知的是「今天下雨通勤慢」「冬天下雪维护贵」，不是云量数值。

确定性：与市民/灾难同一套 blake2b 哈希——同一天永远同一种天气，
replay 与在线完全一致。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

SEASONS: tuple[str, ...] = ("spring", "summer", "autumn", "winter")
SEASON_LABELS: dict[str, str] = {
    "spring": "春",
    "summer": "夏",
    "autumn": "秋",
    "winter": "冬",
}
WEATHER_LABELS: dict[str, str] = {
    "clear": "晴",
    "cloudy": "多云",
    "rain": "雨",
    "snow": "雪",
    "fog": "雾",
}

# 每季的可能天气与权重
_SEASON_WEATHER: dict[str, list[tuple[str, int]]] = {
    "spring": [("clear", 4), ("cloudy", 3), ("rain", 3), ("fog", 1)],
    "summer": [("clear", 6), ("cloudy", 2), ("rain", 3)],
    "autumn": [("clear", 4), ("cloudy", 3), ("rain", 2), ("fog", 1)],
    "winter": [("clear", 3), ("cloudy", 3), ("snow", 3), ("fog", 1)],
}

# 温度区间（摄氏度），按季节
_SEASON_TEMP: dict[str, tuple[int, int]] = {
    "spring": (8, 24),
    "summer": (22, 36),
    "autumn": (6, 22),
    "winter": (-8, 8),
}


def _unit(*parts: object) -> float:
    raw = "|".join(str(part) for part in parts).encode("utf-8")
    digest = hashlib.blake2b(raw, digest_size=8).digest()
    return int.from_bytes(digest, "big") / 2**64


@dataclass(frozen=True)
class WeatherState:
    season: str
    kind: str
    temperature: int
    cloud: float
    rain: float
    fog: float

    @property
    def season_label(self) -> str:
        return SEASON_LABELS.get(self.season, self.season)

    @property
    def label(self) -> str:
        return WEATHER_LABELS.get(self.kind, self.kind)

    def to_dict(self) -> dict:
        return {
            "season": self.season,
            "season_label": self.season_label,
            "kind": self.kind,
            "label": self.label,
            "temperature": self.temperature,
            "cloud": round(self.cloud, 3),
            "rain": round(self.rain, 3),
            "fog": round(self.fog, 3),
        }


def season_of(day_of_year: int, days_per_year: int) -> str:
    """一年等分四季。`day_of_year` 从 1 开始。"""
    if days_per_year <= 0:
        return "spring"
    ratio = ((day_of_year - 1) % days_per_year) / days_per_year
    if ratio < 0.25:
        return "spring"
    if ratio < 0.5:
        return "summer"
    if ratio < 0.75:
        return "autumn"
    return "winter"


def weather_at(seed: int, day_of_year: int, days_per_year: int) -> WeatherState:
    """按 (seed, 日期) 生成确定性天气。"""
    season = season_of(day_of_year, days_per_year)
    table = _SEASON_WEATHER[season]
    total = sum(weight for _, weight in table)
    roll = _unit("weather", seed, day_of_year, season) * total
    kind = table[-1][0]
    for candidate, weight in table:
        if roll < weight:
            kind = candidate
            break
        roll -= weight

    low, high = _SEASON_TEMP[season]
    temperature = low + int(_unit("temp", seed, day_of_year) * (high - low + 1))

    cloud = {"clear": 0.15, "cloudy": 0.55, "rain": 0.85, "snow": 0.9, "fog": 0.6}[kind]
    rain = {"clear": 0.0, "cloudy": 0.0, "rain": 0.75, "snow": 0.0, "fog": 0.0}[kind]
    fog = 0.7 if kind == "fog" else (0.2 if kind == "snow" else 0.0)
    return WeatherState(
        season=season,
        kind=kind,
        temperature=temperature,
        cloud=cloud,
        rain=rain,
        fog=fog,
    )


@dataclass(frozen=True)
class WeatherEffects:
    commute_mult: float
    pollution_mult: float
    upkeep_mult: float

    def to_dict(self) -> dict[str, float]:
        return {
            "commute_mult": round(self.commute_mult, 4),
            "pollution_mult": round(self.pollution_mult, 4),
            "upkeep_mult": round(self.upkeep_mult, 4),
        }


def weather_effects(weather: WeatherState | None) -> WeatherEffects:
    """天气的乘数效应（对齐 C:S：雨天慢、雪天更慢且贵、雾天慢）。"""
    if weather is None:
        return WeatherEffects(1.0, 1.0, 1.0)
    if weather.kind == "rain":
        return WeatherEffects(1.10, 0.92, 1.02)
    if weather.kind == "snow":
        return WeatherEffects(1.20, 0.95, 1.06)
    if weather.kind == "fog":
        return WeatherEffects(1.15, 1.0, 1.01)
    return WeatherEffects(1.0, 1.0, 1.0)

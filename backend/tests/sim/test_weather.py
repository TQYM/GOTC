"""天气：同一天确定性、四季轮转、乘数符合设计。"""

from app.sim.weather import (
    SEASONS,
    WEATHER_LABELS,
    season_of,
    weather_at,
    weather_effects,
)

DAYS = 360


def test_same_day_is_deterministic():
    assert weather_at(123, 17, DAYS) == weather_at(123, 17, DAYS)


def test_different_days_differ_somewhere():
    kinds = {weather_at(7, day, DAYS).kind for day in range(1, 60)}
    assert len(kinds) >= 2


def test_seasons_cycle_in_order():
    assert season_of(1, DAYS) == "spring"
    assert season_of(int(DAYS * 0.25) + 2, DAYS) == "summer"
    assert season_of(int(DAYS * 0.5) + 2, DAYS) == "autumn"
    assert season_of(int(DAYS * 0.75) + 2, DAYS) == "winter"
    assert set(SEASONS) == {"spring", "summer", "autumn", "winter"}


def test_winter_can_snow_and_summer_cannot():
    winter_kinds = {weather_at(11, day, DAYS).kind for day in range(270, 360)}
    summer_kinds = {weather_at(11, day, DAYS).kind for day in range(90, 180)}
    assert "snow" in winter_kinds
    assert "snow" not in summer_kinds


def test_effects_are_slower_in_bad_weather():
    # 直接构造四种天气验证乘数（weather_at 的当天结果不保证是晴）
    from app.sim.weather import WeatherState

    clear = WeatherState("summer", "clear", 28, 0.15, 0.0, 0.0)
    rain = WeatherState("spring", "rain", 15, 0.85, 0.75, 0.0)
    snow = WeatherState("winter", "snow", -2, 0.9, 0.0, 0.2)
    fog = WeatherState("autumn", "fog", 12, 0.6, 0.0, 0.7)
    assert weather_effects(rain).commute_mult > 1.0
    assert weather_effects(snow).commute_mult > weather_effects(rain).commute_mult
    assert weather_effects(fog).commute_mult > 1.0
    assert weather_effects(clear).commute_mult == 1.0
    assert weather_effects(snow).upkeep_mult > 1.0


def test_labels_cover_all_kinds():
    assert set(WEATHER_LABELS) == {"clear", "cloudy", "rain", "snow", "fog"}

using UnityEngine;

namespace Gotc.Sim
{
    public enum Season { Spring, Summer, Autumn, Winter }
    public enum WeatherKind { Clear, Cloudy, Rain, Snow, Fog }

    /// <summary>
    /// 天气与季节 —— 从 Web 版 backend/app/sim/weather.py 移植。
    ///
    /// 与 C:S 的差异：C:S 的 WeatherManager 对 m_current* 到 m_target* 做插值；
    /// 这里按「游戏日」离散切换，够用且可存档。
    /// </summary>
    public struct WeatherState
    {
        public Season season;
        public WeatherKind kind;
        public float temperature;   // 摄氏度
        public float cloud;         // 0..1
        public float rain;          // 0..1
        public float fog;           // 0..1
        public int dayOfYear;       // 用于存档定位

        public string Label => kind switch
        {
            WeatherKind.Clear => "晴",
            WeatherKind.Cloudy => "多云",
            WeatherKind.Rain => "雨",
            WeatherKind.Snow => "雪",
            WeatherKind.Fog => "雾",
            _ => "—",
        };

        public string SeasonLabel => season switch
        {
            Season.Spring => "春",
            Season.Summer => "夏",
            Season.Autumn => "秋",
            Season.Winter => "冬",
            _ => "—",
        };

        public string Icon => kind switch
        {
            WeatherKind.Clear => "☀",
            WeatherKind.Cloudy => "☁",
            WeatherKind.Rain => "☂",
            WeatherKind.Snow => "❄",
            WeatherKind.Fog => "≡",
            _ => "·",
        };
    }

    public struct WeatherEffects
    {
        public float commuteMult;
        public float pollutionMult;
        public float upkeepMult;
    }

    public static class WeatherSystem
    {
        public static Season SeasonOf(int dayOfYear, int daysPerYear)
        {
            int q = Mathf.Clamp(dayOfYear * 4 / Mathf.Max(1, daysPerYear), 0, 3);
            return (Season)q;
        }

        /// <summary>确定性天气：同 seed + 同一天永远得到同一个天气。</summary>
        public static WeatherState At(int seed, int dayOfYear, int daysPerYear)
        {
            var season = SeasonOf(dayOfYear, daysPerYear);
            float r = Unit("weather", seed, dayOfYear, season);
            float t = Unit("temp", seed, dayOfYear);
            float c = Unit("cloud", seed, dayOfYear);

            WeatherKind kind;
            switch (season)
            {
                case Season.Spring:
                    kind = r < 0.42f ? WeatherKind.Clear : r < 0.72f ? WeatherKind.Cloudy : r < 0.94f ? WeatherKind.Rain : WeatherKind.Fog;
                    break;
                case Season.Summer:
                    kind = r < 0.55f ? WeatherKind.Clear : r < 0.80f ? WeatherKind.Cloudy : r < 0.97f ? WeatherKind.Rain : WeatherKind.Fog;
                    break;
                case Season.Autumn:
                    kind = r < 0.40f ? WeatherKind.Clear : r < 0.70f ? WeatherKind.Cloudy : r < 0.92f ? WeatherKind.Rain : WeatherKind.Fog;
                    break;
                default: // Winter
                    kind = r < 0.28f ? WeatherKind.Clear : r < 0.55f ? WeatherKind.Cloudy : r < 0.85f ? WeatherKind.Snow : WeatherKind.Fog;
                    break;
            }

            float baseTemp = season switch
            {
                Season.Spring => 16f,
                Season.Summer => 29f,
                Season.Autumn => 15f,
                _ => -2f,
            };
            float temp = baseTemp + (t - 0.5f) * 10f;

            float cloud = kind switch
            {
                WeatherKind.Clear => 0.10f + c * 0.15f,
                WeatherKind.Cloudy => 0.55f + c * 0.25f,
                WeatherKind.Rain => 0.80f + c * 0.20f,
                WeatherKind.Snow => 0.80f + c * 0.20f,
                _ => 0.70f + c * 0.25f,
            };
            float rain = kind == WeatherKind.Rain ? 0.55f + c * 0.45f : kind == WeatherKind.Snow ? 0.45f + c * 0.35f : 0f;
            float fog = kind == WeatherKind.Fog ? 0.55f + c * 0.40f : kind == WeatherKind.Snow ? 0.15f : 0f;

            return new WeatherState
            {
                dayOfYear = dayOfYear,
                season = season,
                kind = kind,
                temperature = Mathf.Round(temp * 10f) / 10f,
                cloud = cloud,
                rain = rain,
                fog = fog,
            };
        }

        public static WeatherEffects Effects(WeatherState w)
        {
            var e = new WeatherEffects { commuteMult = 1f, pollutionMult = 1f, upkeepMult = 1f };
            switch (w.kind)
            {
                case WeatherKind.Rain:
                    e.commuteMult = 1.10f; e.pollutionMult = 0.92f; e.upkeepMult = 1.02f;
                    break;
                case WeatherKind.Snow:
                    e.commuteMult = 1.20f; e.pollutionMult = 0.95f; e.upkeepMult = 1.06f;
                    break;
                case WeatherKind.Fog:
                    e.commuteMult = 1.15f; e.pollutionMult = 1.00f; e.upkeepMult = 1.01f;
                    break;
                case WeatherKind.Cloudy:
                    e.commuteMult = 1.02f;
                    break;
            }
            return e;
        }

        static float Unit(params object[] parts)
        {
            var sb = new System.Text.StringBuilder(48);
            for (int i = 0; i < parts.Length; i++)
            {
                if (i > 0) sb.Append('|');
                sb.Append(parts[i]);
            }
            ulong h = 14695981039346656037UL;
            for (int i = 0; i < sb.Length; i++) { h ^= sb[i]; h *= 1099511628211UL; }
            return (float)((h >> 11) * (1.0 / 9007199254740992.0));
        }
    }
}

using System.Collections.Generic;
using UnityEngine;

namespace Gotc.Sim
{
    public struct MilestoneTier
    {
        public int tier;
        public int population;
        public string label;
        public string[] unlocks;
    }

    /// <summary>
    /// 里程碑 —— 从 Web 版 backend/app/sim/milestones.py 移植。
    /// 只做展示不做硬校验：硬校验会让老存档的高密建筑变非法，C:S 靠「已建的不拆」规避。
    /// </summary>
    public static class Milestones
    {
        public static readonly MilestoneTier[] Tiers =
        {
            new MilestoneTier { tier = 1, population = 0,     label = "村庄",   unlocks = new[] { "低密度住宅", "小商铺", "轻工业", "土路" } },
            new MilestoneTier { tier = 2, population = 300,   label = "集镇",   unlocks = new[] { "中密度住宅", "写字楼", "重工业", "小学" } },
            new MilestoneTier { tier = 3, population = 1500,  label = "小城",   unlocks = new[] { "高密度住宅", "诊所", "城市大道", "警察局" } },
            new MilestoneTier { tier = 4, population = 5000,  label = "城市",   unlocks = new[] { "地铁", "高速公路", "消防局", "垃圾处理" } },
            new MilestoneTier { tier = 5, population = 12000, label = "大都会", unlocks = new[] { "污水处理", "发电厂", "水厂" } },
        };

        public static MilestoneTier Current(int population)
        {
            var best = Tiers[0];
            for (int i = 0; i < Tiers.Length; i++)
            {
                if (population >= Tiers[i].population) best = Tiers[i];
            }
            return best;
        }

        public static bool HasNext(int population, out MilestoneTier next, out float progress)
        {
            var cur = Current(population);
            int idx = cur.tier;   // tier 从 1 开始，索引正好是下一个
            if (idx >= Tiers.Length)
            {
                next = cur;
                progress = 1f;
                return false;
            }
            next = Tiers[idx];
            float span = Mathf.Max(1, next.population - cur.population);
            progress = Mathf.Clamp01((population - cur.population) / span);
            return true;
        }
    }

    /// <summary>一年一条的统计记录，用于折线图。</summary>
    public struct YearRecord
    {
        public int year;
        public int population;
        public int jobs;
        public long funds;
        public float happiness;
        public float congestion;
        public float pollution;
        public int avgCommute;
        public long taxIncome;
        public long upkeep;
    }

    public sealed class Statistics
    {
        public const int MaxRecords = 60;
        public readonly List<YearRecord> records = new List<YearRecord>();

        public void Add(YearRecord rec)
        {
            records.Add(rec);
            if (records.Count > MaxRecords) records.RemoveAt(0);
        }

        public void Clear() => records.Clear();
    }
}

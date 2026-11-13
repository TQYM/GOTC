using System.Collections.Generic;
using UnityEngine;

namespace Gotc.Core
{
    /// <summary>C:S 的区政策（docs/plan/12-cs-parity.md 对齐表）。</summary>
    public enum CityPolicy
    {
        FreeTransit,
        SmokeBan,
        Recycling,
        EvMandate,
        NightBudget,
    }

    [System.Serializable]
    public class District
    {
        public int id;
        public string name;
        public readonly HashSet<int> cells = new HashSet<int>();
        public readonly HashSet<CityPolicy> policies = new HashSet<CityPolicy>();
    }

    /// <summary>
    /// 行政区管理器：最多 256 个区（对齐 C:S 的 byte district id）。
    /// 区只收「已有地块」，政策只影响本区地块的模拟系数。
    /// </summary>
    public class DistrictManager
    {
        public const int MaxDistricts = 256;

        public readonly List<District> districts = new List<District>();
        int _nextId;

        public District Create(string name, int r, int c, int rows, int cols, GridMap map)
        {
            if (districts.Count >= MaxDistricts) return null;
            var d = new District { id = _nextId++, name = string.IsNullOrWhiteSpace(name) ? $"区 {districts.Count + 1}" : name };
            for (int i = 0; i < rows; i++)
                for (int j = 0; j < cols; j++)
                {
                    int rr = r + i, cc = c + j;
                    if (!map.InBounds(rr, cc)) continue;
                    if (map.Cells[rr, cc].kind == TileKind.Empty) continue;
                    d.cells.Add(rr * GridMap.Size + cc);
                }
            if (d.cells.Count == 0) return null;
            districts.Add(d);
            return d;
        }

        public bool SetPolicy(int id, CityPolicy policy, bool on)
        {
            var d = districts.Find(x => x.id == id);
            if (d == null) return false;
            if (on) d.policies.Add(policy); else d.policies.Remove(policy);
            return true;
        }

        public bool Remove(int id) => districts.RemoveAll(x => x.id == id) > 0;

        public District At(int r, int c)
        {
            int key = r * GridMap.Size + c;
            for (int i = 0; i < districts.Count; i++)
                if (districts[i].cells.Contains(key)) return districts[i];
            return null;
        }

        /// <summary>把一个地块的区政策汇总成系数（与 Python 版 district.effects 同构）。</summary>
        public struct Effects
        {
            public float taxDelta;
            public float pollutionDelta;
            public float happiness;
            public float eduBonus;
            public float jobsMult;
            public bool blockHeavy;
        }

        public Effects EffectsAt(int r, int c)
        {
            var fx = new Effects { jobsMult = 1f };
            var d = At(r, c);
            if (d == null) return fx;
            foreach (var p in d.policies)
            {
                switch (p)
                {
                    case CityPolicy.FreeTransit: fx.happiness += 2f; break;
                    case CityPolicy.SmokeBan: fx.happiness += 5f; fx.taxDelta -= 0.27f; break;
                    case CityPolicy.Recycling: fx.pollutionDelta -= 0.15f; break;
                    case CityPolicy.EvMandate: fx.pollutionDelta -= 0.10f; break;
                    case CityPolicy.NightBudget: fx.happiness -= 3f; break;
                }
            }
            if (fx.pollutionDelta < -0.5f) fx.pollutionDelta = -0.5f;
            return fx;
        }

        /// <summary>城市级政策（与区政策独立，对齐 C:S 的 city policies）。</summary>
        public readonly HashSet<CityPolicy> cityPolicies = new HashSet<CityPolicy>();

        public Effects CityEffects()
        {
            var fx = new Effects { jobsMult = 1f };
            foreach (var p in cityPolicies)
            {
                switch (p)
                {
                    case CityPolicy.FreeTransit: fx.happiness += 1f; break;
                    case CityPolicy.SmokeBan: fx.happiness += 5f; break;
                    case CityPolicy.Recycling: fx.pollutionDelta -= 0.15f; break;
                    case CityPolicy.EvMandate: fx.pollutionDelta -= 0.10f; break;
                    case CityPolicy.NightBudget: fx.happiness -= 3f; break;
                }
            }
            return fx;
        }

        public string[] Names()
        {
            var arr = new string[districts.Count];
            for (int i = 0; i < districts.Count; i++) arr[i] = districts[i].name;
            return arr;
        }
    }
}

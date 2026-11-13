using System.Collections.Generic;
using UnityEngine;

namespace Gotc.Sim
{
    public enum PolicyKey
    {
        FreeTransit,
        SmokeBan,
        Recycling,
        EvMandate,
        NightBudget,
    }

    public struct PolicyDef
    {
        public PolicyKey key;
        public string label;
        public string desc;
    }

    public struct PolicyEffects
    {
        public float commuteMult;
        public float pollutionMult;
        public float upkeepMult;
        public float taxMult;
        public float transitIncomeMult;
        public float happiness;
        public float jobsMult;
    }

    /// <summary>
    /// 城市级政策 —— 从 Web 版 backend/app/sim/policies.py 移植。
    /// 与区政策（Districts.cs 里的 CityPolicy 枚举）不同：这里作用于全城。
    /// </summary>
    public static class CityPolicies
    {
        public static readonly PolicyDef[] All =
        {
            new PolicyDef { key = PolicyKey.FreeTransit, label = "免费公交", desc = "通勤 ×0.90，公交收入 0，维护 ×1.04" },
            new PolicyDef { key = PolicyKey.SmokeBan,    label = "禁烟令",   desc = "幸福 +5，税收 ×0.97" },
            new PolicyDef { key = PolicyKey.Recycling,   label = "垃圾分类", desc = "污染 ×0.85，维护 ×1.05" },
            new PolicyDef { key = PolicyKey.EvMandate,   label = "电动化",   desc = "污染 ×0.90，维护 ×1.03" },
            new PolicyDef { key = PolicyKey.NightBudget, label = "夜间预算", desc = "幸福 -3，夜间维护 ×0.88" },
        };

        public static PolicyEffects Evaluate(HashSet<PolicyKey> active)
        {
            var e = new PolicyEffects
            {
                commuteMult = 1f,
                pollutionMult = 1f,
                upkeepMult = 1f,
                taxMult = 1f,
                transitIncomeMult = 1f,
                happiness = 0f,
                jobsMult = 1f,
            };
            if (active == null) return e;

            if (active.Contains(PolicyKey.FreeTransit))
            {
                e.commuteMult *= 0.90f;
                e.transitIncomeMult = 0f;
                e.upkeepMult *= 1.04f;
            }
            if (active.Contains(PolicyKey.SmokeBan))
            {
                e.happiness += 5f;
                e.taxMult *= 0.97f;
            }
            if (active.Contains(PolicyKey.Recycling))
            {
                e.pollutionMult *= 0.85f;
                e.upkeepMult *= 1.05f;
            }
            if (active.Contains(PolicyKey.EvMandate))
            {
                e.pollutionMult *= 0.90f;
                e.upkeepMult *= 1.03f;
            }
            if (active.Contains(PolicyKey.NightBudget))
            {
                e.happiness -= 3f;
                e.upkeepMult *= 0.88f;
            }
            return e;
        }
    }
}

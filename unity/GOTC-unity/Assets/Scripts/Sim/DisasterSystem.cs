using System.Collections.Generic;
using UnityEngine;

namespace Gotc.Sim
{
    public enum DisasterKind { Fire, Flood, Meteor }

    public struct DisasterResult
    {
        public DisasterKind kind;
        public int r;
        public int c;
        public int happinessDelta;
        public string Label => kind switch
        {
            DisasterKind.Fire => "火灾",
            DisasterKind.Flood => "内涝",
            DisasterKind.Meteor => "陨石",
            _ => "灾害",
        };
    }

    /// <summary>
    /// 灾难系统 —— 从 Web 版 backend/app/sim/disasters.py 移植。
    /// 概率常数与 Web 版一致；用确定性哈希，保证同一存档重放同一结果。
    /// </summary>
    public static class DisasterSystem
    {
        public const float FireBase = 0.06f;
        public const float FloodBase = 0.04f;
        public const float MeteorBase = 0.002f;

        public static int HappinessDelta(DisasterKind k) => k switch
        {
            DisasterKind.Fire => -6,
            DisasterKind.Flood => -8,
            DisasterKind.Meteor => -12,
            _ => 0,
        };

        /// <summary>
        /// 每年掷一次。fireCoverage = 消防覆盖率（0..1），riverNear = 城里有河道，
        /// density = 建筑密度（0..1，越高越容易起火）。
        /// </summary>
        public static bool TryRoll(
            int seed, int year,
            float fireCoverage, bool riverNear, float density,
            List<Vector2Int> candidates,
            out DisasterResult result)
        {
            result = default;
            if (candidates == null || candidates.Count == 0) return false;

            float fireChance = FireBase * (1f - Mathf.Clamp01(fireCoverage)) * (0.5f + Mathf.Clamp01(density));
            float floodChance = riverNear ? FloodBase : 0f;
            float meteorChance = MeteorBase;

            float roll = Unit("disaster-kind", seed, year) * (fireChance + floodChance + meteorChance + 0.98f);

            DisasterKind kind;
            if (roll < fireChance) kind = DisasterKind.Fire;
            else if (roll < fireChance + floodChance) kind = DisasterKind.Flood;
            else if (roll < fireChance + floodChance + meteorChance) kind = DisasterKind.Meteor;
            else return false;

            int idx = (int)(Unit("disaster-pos", seed, year) * candidates.Count);
            var cell = candidates[Mathf.Clamp(idx, 0, candidates.Count - 1)];

            result = new DisasterResult
            {
                kind = kind,
                r = cell.x,
                c = cell.y,
                happinessDelta = HappinessDelta(kind),
            };
            return true;
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

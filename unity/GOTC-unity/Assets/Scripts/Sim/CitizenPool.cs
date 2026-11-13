using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace Gotc.Sim
{
    /// <summary>
    /// 市民体系统计层 —— 从 Web 版 backend/app/sim/citizens.py 移植。
    ///
    /// C:S 用三级数组（Citizen 104 万 / CitizenUnit 52 万 / CitizenInstance 6.5 万），
    /// 在 C# 里逐帧遍历 100 万条不现实，所以这里保留统计形状：
    ///   800 个代理 × scale（每人代表 population / agents 人）。
    ///
    /// 所有随机都走确定性哈希（FNV-1a），不用 System.Random：
    /// 存档读回后从同一状态继续演化，结果必须逐比特一致。
    /// </summary>
    public sealed class CitizenPool
    {
        public const int AgentLimit = 800;
        public const int MinAgents = 12;
        public const int AgeMax = 100;
        public const int LifeExpectancy = 78;
        public const int EduLevels = 4;          // 0 未受教育 / 1 小学 / 2 中学 / 3 大学

        public const float EduSchoolBonus = 0.18f;
        public const float EduBaseChance = 0.08f;
        public const float UnemployedHappiness = -18f;
        public const float CommuteHappinessScale = -0.35f;
        public const float PollutionHappinessScale = -0.25f;
        public const float EduHappinessBonus = 4f;

        public struct Agent
        {
            public int cid;
            public int age;
            public int education;
            public float happiness;
            public int commute;
            public bool employed;
        }

        public readonly List<Agent> agents = new List<Agent>();
        public float scale;
        public int population;
        public int seed;

        public int Count => agents.Count;

        public float AvgAge
        {
            get
            {
                if (agents.Count == 0) return 0f;
                float sum = 0f;
                for (int i = 0; i < agents.Count; i++) sum += agents[i].age;
                return sum / agents.Count;
            }
        }

        public float AvgHappiness
        {
            get
            {
                if (agents.Count == 0) return 60f;
                float sum = 0f;
                for (int i = 0; i < agents.Count; i++) sum += agents[i].happiness;
                return sum / agents.Count;
            }
        }

        public float EmploymentRate
        {
            get
            {
                if (agents.Count == 0) return 0f;
                int n = 0;
                for (int i = 0; i < agents.Count; i++) if (agents[i].employed) n++;
                return (float)n / agents.Count;
            }
        }

        /// <summary>年龄分布：0-14 / 15-29 / 30-44 / 45-59 / 60+，返回 5 个占比。</summary>
        public float[] AgeDistribution()
        {
            var buckets = new float[5];
            if (agents.Count == 0) return buckets;
            for (int i = 0; i < agents.Count; i++)
            {
                int a = agents[i].age;
                int idx = a < 15 ? 0 : a < 30 ? 1 : a < 45 ? 2 : a < 60 ? 3 : 4;
                buckets[idx] += 1f;
            }
            for (int i = 0; i < buckets.Length; i++) buckets[i] /= agents.Count;
            return buckets;
        }

        /// <summary>教育分布：4 档占比。</summary>
        public float[] EducationDistribution()
        {
            var buckets = new float[EduLevels];
            if (agents.Count == 0) return buckets;
            for (int i = 0; i < agents.Count; i++)
                buckets[Mathf.Clamp(agents[i].education, 0, EduLevels - 1)] += 1f;
            for (int i = 0; i < buckets.Length; i++) buckets[i] /= agents.Count;
            return buckets;
        }

        public void SetSeed(int value)
        {
            seed = value;
        }

        /// <summary>
        /// 按当前人口同步代理数量。只在数量变化时增删，避免每 256 帧洗牌。
        /// </summary>
        public void Sync(int targetPopulation)
        {
            population = Mathf.Max(0, targetPopulation);
            int want = population <= 0
                ? 0
                : Mathf.Clamp(population / 200, MinAgents, AgentLimit);

            while (agents.Count < want)
            {
                int cid = agents.Count;
                agents.Add(new Agent
                {
                    cid = cid,
                    age = 5 + (int)(Unit("seed", seed, "age", cid) * 58f),
                    education = PickEducation(Unit("seed", seed, "edu", cid)),
                    happiness = 60f,
                    commute = 0,
                    employed = false,
                });
            }
            while (agents.Count > want)
            {
                agents.RemoveAt(agents.Count - 1);
            }
            scale = agents.Count == 0 ? 0f : (float)population / agents.Count;
        }

        static int PickEducation(float roll)
        {
            if (roll < 0.25f) return 0;
            if (roll < 0.55f) return 1;
            if (roll < 0.85f) return 2;
            return 3;
        }

        /// <summary>
        /// 逐年推进：年龄 +1、超预期寿命按概率死亡、就学/就业/幸福重算。
        /// 参数都来自当年的城市指标，调用点在 CitySim.SettleYear。
        /// </summary>
        public void AdvanceYear(
            int year,
            float schoolCoverage,
            float clinicCoverage,
            float pollution,
            int avgCommute,
            int jobOpenings)
        {
            if (agents.Count == 0) return;

            // 1) 年龄与死亡
            for (int i = 0; i < agents.Count; i++)
            {
                var a = agents[i];
                a.age += 1;

                float deathChance = 0f;
                if (a.age > LifeExpectancy)
                {
                    deathChance = Mathf.Clamp01((a.age - LifeExpectancy) / 22f) * (1f - clinicCoverage * 0.35f);
                }
                if (a.age >= AgeMax || Unit("death", a.cid, year) < deathChance)
                {
                    // 去世的代理由新代理顶替（保持代理数量稳定）
                    int cid = agents.Count + year * 1000;
                    a = new Agent
                    {
                        cid = cid,
                        age = 5 + (int)(Unit("born", seed, year, cid) * 20f),
                        education = 0,
                        happiness = 60f,
                        commute = 0,
                        employed = false,
                    };
                }

                // 2) 教育：学校覆盖越高，升学概率越大
                if (a.education < EduLevels - 1)
                {
                    float chance = EduBaseChance + schoolCoverage * EduSchoolBonus;
                    if (Unit("edu-up", a.cid, year) < chance) a.education += 1;
                }

                // 3) 就业：岗位数 > 求职人数时更容易就业
                float jobChance = jobOpenings <= 0 ? 0f : Mathf.Clamp01((float)jobOpenings / Mathf.Max(1, agents.Count));
                a.employed = Unit("job", a.cid, year) < jobChance;

                // 4) 幸福：通勤 + 污染 + 失业 + 教育 + 医疗
                float h = 60f;
                h += a.commute * CommuteHappinessScale;
                h += pollution * PollutionHappinessScale;
                if (!a.employed) h += UnemployedHappiness;
                h += a.education * EduHappinessBonus;
                h += clinicCoverage * 6f;
                a.happiness = Mathf.Clamp(h, 0f, 100f);
                a.commute = avgCommute;

                agents[i] = a;
            }
        }

        // ---- 确定性哈希：跨存档/跨重放必须一致，所以不用 System.Random ----
        static float Unit(params object[] parts)
        {
            var sb = new StringBuilder(64);
            for (int i = 0; i < parts.Length; i++)
            {
                if (i > 0) sb.Append('|');
                sb.Append(parts[i]);
            }
            // FNV-1a 64
            ulong h = 14695981039346656037UL;
            for (int i = 0; i < sb.Length; i++)
            {
                h ^= sb[i];
                h *= 1099511628211UL;
            }
            return (float)((h >> 11) * (1.0 / 9007199254740992.0));
        }

        public Agent[] Snapshot() => agents.ToArray();

        public void Restore(Agent[] data, int savedPopulation)
        {
            agents.Clear();
            if (data != null) agents.AddRange(data);
            population = savedPopulation;
            scale = agents.Count == 0 ? 0f : (float)population / agents.Count;
        }
    }
}

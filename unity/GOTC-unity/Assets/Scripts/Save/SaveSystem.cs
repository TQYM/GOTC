using System;
using System.Collections.Generic;
using System.IO;
using Gotc.Core;
using Gotc.Sim;
using UnityEngine;

namespace Gotc.Save
{
    [Serializable] public class CellDTO
    {
        public int terrain;
        public int kind;
        public int level;
        public float built;
        public float occupancy;
    }

    [Serializable] public class AgentDTO
    {
        public int cid;
        public int age;
        public int education;
        public float happiness;
        public int commute;
        public bool employed;
    }

    [Serializable] public class DistrictDTO
    {
        public int id;
        public string name;
        public int[] cells;
    }

    [Serializable] public class TransitDTO
    {
        public int id;
        public string name;
        public int kind;
        public int[] cells;
        public float price;
    }

    [Serializable] public class YearDTO
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

    /// <summary>
    /// 存档 —— 全量快照写 JSON 到 Application.persistentDataPath。
    ///
    /// 与 Web 版（SQLite 事件溯源 + 快照）的取舍：Unity 版是单机原型，
    /// 全量快照足够；Web 版需要多端同步与幂等重放，才用事件溯源。
    /// </summary>
    [Serializable]
    public class SaveData
    {
        public int version = 1;
        public string cityName = "CITY20";
        public string savedAt;

        public long funds;
        public float taxRate;
        public float landPrice;
        public int population;
        public int jobs;
        public int buildings;

        public uint frame;
        public int speed;
        public int atYear;

        public float actualResidential, actualCommercial, actualWorkplace;
        public float displayedResidential, displayedCommercial, displayedWorkplace;

        public long dayIncome, dayExpense, debt;

        public int seed;
        public CellDTO[] cells;

        public int citizenSeed;
        public int citizenPopulation;
        public AgentDTO[] agents;

        public DistrictDTO[] districts;
        public TransitDTO[] transit;

        public int weatherDay;
        public string weatherKind;
        public string weatherSeason;
        public float temperature;

        public string lastDisaster;
        public int lastDisasterR = -1;
        public int lastDisasterC = -1;
        public int disasterPenalty;

        public YearDTO[] history;
        public int[] policies;
    }

    public static class SaveSystem
    {
        public static string Dir => Path.Combine(Application.persistentDataPath, "saves");
        public static string PathFor(string slot) => Path.Combine(Dir, $"{slot}.json");

        public static bool Save(string slot, SaveData data)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                data.savedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                string json = JsonUtility.ToJson(data, true);
                File.WriteAllText(PathFor(slot), json);
                Debug.Log($"[Save] {PathFor(slot)} ({json.Length} bytes)");
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Save] 失败: {ex.Message}");
                return false;
            }
        }

        public static SaveData Load(string slot)
        {
            string path = PathFor(slot);
            if (!File.Exists(path)) return null;
            try
            {
                return JsonUtility.FromJson<SaveData>(File.ReadAllText(path));
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Save] 读取失败: {ex.Message}");
                return null;
            }
        }

        public static bool Exists(string slot) => File.Exists(PathFor(slot));
    }

    /// <summary>把运行中的城市状态与 SaveData 互转。</summary>
    public static class SaveMapper
    {
        public static SaveData Capture(
            CitySim sim, GridMap map, SimClock clock,
            CitizenPool citizens, DistrictManager districts, TransitManager transit,
            WeatherState weather, Statistics stats, HashSet<PolicyKey> policies,
            string cityName = "CITY20")
        {
            var data = new SaveData
            {
                cityName = cityName,
                funds = sim.funds,
                taxRate = sim.taxRate,
                landPrice = sim.landPrice,
                population = sim.population,
                jobs = sim.jobs,
                buildings = sim.buildings,
                frame = clock.Frame,
                speed = clock.Speed,
                atYear = clock.Year,
                actualResidential = sim.actualResidential,
                actualCommercial = sim.actualCommercial,
                actualWorkplace = sim.actualWorkplace,
                displayedResidential = sim.displayedResidential,
                displayedCommercial = sim.displayedCommercial,
                displayedWorkplace = sim.displayedWorkplace,
                dayIncome = sim.dayIncome,
                dayExpense = sim.dayExpense,
                debt = sim.debt,
                seed = map.seed,
                citizenSeed = citizens != null ? citizens.seed : 0,
                citizenPopulation = citizens != null ? citizens.population : 0,
                weatherDay = weather.dayOfYear,
                weatherKind = weather.kind.ToString(),
                weatherSeason = weather.season.ToString(),
                temperature = weather.temperature,
                lastDisaster = sim.lastDisaster,
                lastDisasterR = sim.lastDisasterR,
                lastDisasterC = sim.lastDisasterC,
                disasterPenalty = sim.disasterPenalty,
            };

            // 地块
            var cells = new CellDTO[GridMap.Size * GridMap.Size];
            int i = 0;
            for (int r = 0; r < GridMap.Size; r++)
            for (int c = 0; c < GridMap.Size; c++)
            {
                var cell = map.Cells[r, c];
                cells[i++] = new CellDTO
                {
                    terrain = (int)cell.terrain,
                    kind = (int)cell.kind,
                    level = cell.level,
                    built = cell.built,
                    occupancy = cell.occupancy,
                };
            }
            data.cells = cells;

            // 市民
            if (citizens != null)
            {
                var agents = new AgentDTO[citizens.agents.Count];
                for (int k = 0; k < agents.Length; k++)
                {
                    var a = citizens.agents[k];
                    agents[k] = new AgentDTO
                    {
                        cid = a.cid, age = a.age, education = a.education,
                        happiness = a.happiness, commute = a.commute, employed = a.employed,
                    };
                }
                data.agents = agents;
            }

            // 行政区
            if (districts != null)
            {
                var list = new List<DistrictDTO>();
                foreach (var d in districts.districts)
                {
                    list.Add(new DistrictDTO { id = d.id, name = d.name, cells = ToArray(d.cells) });
                }
                data.districts = list.ToArray();
            }

            // 公交
            if (transit != null)
            {
                var list = new List<TransitDTO>();
                foreach (var line in transit.lines)
                {
                    list.Add(new TransitDTO
                    {
                        id = line.id, name = line.name, kind = (int)line.kind,
                        cells = line.cells.ToArray(), price = line.price,
                    });
                }
                data.transit = list.ToArray();
            }

            // 统计
            if (stats != null)
            {
                var hist = new List<YearDTO>();
                foreach (var rec in stats.records)
                {
                    hist.Add(new YearDTO
                    {
                        year = rec.year, population = rec.population, jobs = rec.jobs,
                        funds = rec.funds, happiness = rec.happiness, congestion = rec.congestion,
                        pollution = rec.pollution, avgCommute = rec.avgCommute,
                        taxIncome = rec.taxIncome, upkeep = rec.upkeep,
                    });
                }
                data.history = hist.ToArray();
            }

            if (policies != null)
            {
                var list = new List<int>();
                foreach (var p in policies) list.Add((int)p);
                data.policies = list.ToArray();
            }

            return data;
        }

        static int[] ToArray(HashSet<int> set)
        {
            var arr = new int[set.Count];
            set.CopyTo(arr);
            return arr;
        }
    }
}

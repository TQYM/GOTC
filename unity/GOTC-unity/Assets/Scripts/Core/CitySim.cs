using System.Collections.Generic;
using Gotc.Sim;
using UnityEngine;

namespace Gotc.Core
{
    /// <summary>
    /// 城市模拟内核 —— 从 Web 版 backend/app/core/city.py 移植。
    ///
    /// 与 C:S 对齐的规则：
    ///   1. 建造闸门：每 8 帧最多落成一栋（C:S ZoneManager.cs:910-937）。
    ///   2. 需求双轨：真值驱动建造，显示值缓慢跟随（C:S m_actual* 与 m_*Demand）。
    ///   3. 经济按日结算：256 帧 = 1 预算日（C:S EconomyManager 的 16 段 × 16 帧）。
    ///   4. 年度结算：585.14 帧/日 × 365 ≈ 3600 帧 = 1 年，触发市民、灾难、统计。
    /// </summary>
    public sealed class CitySim : MonoBehaviour
    {
        public GridMap map;
        public SimClock clock;

        [Header("经济")]
        public long funds = 5_000_000;
        public float taxRate = 9f;
        public float landPrice = 20f;

        [Header("需求（真值）")]
        public float actualResidential;
        public float actualCommercial;
        public float actualWorkplace;

        [Header("需求（显示，0..1）")]
        public float displayedResidential = 0.5f;
        public float displayedCommercial = 0.5f;
        public float displayedWorkplace = 0.5f;

        [Header("统计")]
        public int population;
        public int jobs;
        public int buildings;
        public float happiness = 60f;
        public float congestion;
        public float pollution;
        public int avgCommute;

        [Header("子系统")]
        public CitizenPool citizens = new CitizenPool();
        public DistrictManager districts = new DistrictManager();
        public TransitManager transit = new TransitManager();
        public readonly Statistics stats = new Statistics();
        public readonly HashSet<PolicyKey> cityPolicies = new HashSet<PolicyKey>();

        public WeatherState weather;
        public PolicyEffects policyFx;

        [Header("灾难")]
        public string lastDisaster;
        public int lastDisasterR = -1;
        public int lastDisasterC = -1;
        public int disasterPenalty;

        [Header("统计")]
        public int atYear = 1;

        const int GateInterval = 8;
        const float BuildPerFrame = 0.05f;
        const float DemandSmooth = 0.10f;
        const float MigrationLimit = 0.08f;

        int _lastGateWindow = -1;
        int _weatherDayCache = -1;
        int _lastYear = 1;

        void Awake()
        {
            if (clock != null) clock.Stepped += OnStep;
        }

        void OnDestroy()
        {
            if (clock != null) clock.Stepped -= OnStep;
        }

        void Start()
        {
            // GameBootstrap 是先 AddComponent 再赋 map/clock，Awake 时 clock 还是 null，
            // 所以订阅必须放到 Start（或在赋 clock 之后）重新做一次。
            if (clock != null)
            {
                clock.Stepped -= OnStep;
                clock.Stepped += OnStep;
            }
            RefreshWeather(true);
            RefreshPolicies();
        }

        void OnStep(int subStep)
        {
            if (subStep == 0) return;               // 暂停：只刷新，不推进模拟

            uint frame = clock.Frame;

            if (frame % 16 == 0) RefreshDemand();
            SmoothDemand();

            if (CanBuild(frame)) TryBuild(frame);

            TryUpgrade((int)frame);

            if (frame % 256 == 0)
            {
                Recompute();
                SettleDay();
                RefreshWeather(false);
            }

            if (frame % 64 == 0) AdvanceCitizensStep();

            if (clock.Year > _lastYear)
            {
                _lastYear = clock.Year;
                SettleYear();
            }
        }

        // ---- 天气 ----
        public void RefreshWeather(bool force)
        {
            int daysPerYear = Mathf.Max(1, SimClock.FramesPerYear / SimClock.FramesPerDay);
            int day = clock.DayOfYear;
            if (!force && day == _weatherDayCache) return;
            _weatherDayCache = day;
            weather = WeatherSystem.At(map.seed, day, daysPerYear);
        }

        public void RefreshPolicies()
        {
            policyFx = CityPolicies.Evaluate(cityPolicies);
        }

        public void TogglePolicy(PolicyKey key)
        {
            if (!cityPolicies.Add(key)) cityPolicies.Remove(key);
            RefreshPolicies();
            Recompute();
        }

        // ---- 建造 ----
        bool CanBuild(uint frame)
        {
            int window = (int)(frame / GateInterval);
            if (window == _lastGateWindow) return false;
            _lastGateWindow = window;
            return true;
        }

        void TryBuild(uint frame)
        {
            float demand = actualResidential;
            if (demand <= 0f) return;

            var rng = new System.Random(unchecked((int)(frame * 2654435761u)));
            if (rng.NextDouble() >= demand) return;

            int bestR = -1, bestC = -1;
            float bestBuilt = 1f;
            for (int r = 0; r < GridMap.Size; r++)
            for (int c = 0; c < GridMap.Size; c++)
            {
                var cell = map.Cells[r, c];
                if (cell.kind != TileKind.Residential) continue;
                if (cell.built >= 1f - 1e-4f) continue;
                if (cell.built < bestBuilt) { bestBuilt = cell.built; bestR = r; bestC = c; }
            }
            if (bestR < 0) return;

            var target = map.Cells[bestR, bestC];
            target.built = Mathf.Min(1f, target.built + BuildPerFrame);
            target.occupancy = Mathf.Min(1f, target.occupancy + BuildPerFrame);
            map.Cells[bestR, bestC] = target;
            buildings++;
        }

        // ---- 需求 ----
        void RefreshDemand()
        {
            int capacity = 0, occupied = 0, commercialCapacity = 0, industrialCapacity = 0;
            for (int r = 0; r < GridMap.Size; r++)
            for (int c = 0; c < GridMap.Size; c++)
            {
                var cell = map.Cells[r, c];
                int cap = CapacityOf(cell.kind, cell.level);
                if (cap == 0) continue;
                if (cell.kind == TileKind.Residential)
                {
                    capacity += Mathf.RoundToInt(cap * cell.built);
                    occupied += Mathf.RoundToInt(cap * cell.built * cell.occupancy);
                }
                else if (cell.kind == TileKind.Commercial) commercialCapacity += Mathf.RoundToInt(cap * cell.built);
                else industrialCapacity += Mathf.RoundToInt(cap * cell.built);
            }

            population = occupied;
            jobs = Mathf.RoundToInt((commercialCapacity + industrialCapacity) * policyFx.jobsMult);


            actualResidential = capacity == 0 ? 1f : Mathf.Clamp(1f - (float)occupied / capacity, -1f, 1f);
            actualCommercial = commercialCapacity == 0 ? 1f : Mathf.Clamp(1f - (float)jobs / Mathf.Max(1, occupied / 2), -1f, 1f);
            actualWorkplace = jobs == 0 ? 0.5f : Mathf.Clamp(1f - (float)jobs / Mathf.Max(1, occupied * 55 / 100), -1f, 1f);
        }

        void SmoothDemand()
        {
            displayedResidential = Mathf.Lerp(displayedResidential, Mathf.Clamp01(actualResidential), DemandSmooth);
            displayedCommercial = Mathf.Lerp(displayedCommercial, Mathf.Clamp01(actualCommercial), DemandSmooth);
            displayedWorkplace = Mathf.Lerp(displayedWorkplace, Mathf.Clamp01(actualWorkplace), DemandSmooth);
        }

        public void Recompute()
        {
            // 地价 0..100：人口 6000 时约 50，18000 时约 100（对齐 Web 版的 land_price_index）
            landPrice = Mathf.Clamp(20f + population / 180f, 15f, 100f);

            // 幸福：基础 62，通勤/污染/失业扣分，政策与服务加分
            float h = 62f;
            h -= Mathf.Clamp(avgCommute - 20, 0, 100) * 0.18f;
            h -= pollution * 12f;
            if (jobs < population * 0.55f) h -= 12f;
            h += policyFx.happiness;
            happiness = Mathf.Clamp(h, 0f, 100f);

            // 通勤：按建筑密度粗算（Web 版走 Dijkstra，这里用密度近似）
            int dense = Mathf.Min(buildings, 4000);
            avgCommute = Mathf.RoundToInt(12f + dense / 90f);
            congestion = Mathf.Clamp01(dense / 3000f);
            pollution = Mathf.Clamp01(industrialCapacity01() * policyFx.pollutionMult);

            citizens.Sync(population);
        }

        float industrialCapacity01()
        {
            int ind = 0;
            for (int r = 0; r < GridMap.Size; r++)
            for (int c = 0; c < GridMap.Size; c++)
            {
                var cell = map.Cells[r, c];
                if (cell.kind == TileKind.Industrial) ind += Mathf.RoundToInt(CapacityOf(cell.kind, cell.level) * cell.built);
            }
            return Mathf.Clamp01(ind / 3000f);
        }

        public static int CapacityOf(TileKind kind, int level) => kind switch
        {
            TileKind.Residential => level == 0 ? 300 : level == 1 ? 900 : 2400,
            TileKind.Commercial => 200,
            TileKind.Industrial => 350,
            _ => 0
        };

        // ---- 财政 ----
        public long dayIncome;
        public long dayExpense;
        public long debt;
        long _lastSettleDay;

        public void SettleDay()
        {
            var fx = WeatherSystem.Effects(weather);
            dayIncome = (long)(population * taxRate * 12.0 * policyFx.taxMult);
            dayExpense = (long)(buildings * 45.0 * policyFx.upkeepMult * fx.upkeepMult);
            funds += dayIncome - dayExpense;
            _lastSettleDay++;
            if (debt > 0 && _lastSettleDay % 30 == 0)
            {
                long pay = debt / 60;
                if (pay < 1000) pay = 1000;
                if (pay > funds) pay = funds;
                funds -= pay;
                debt -= pay;
            }
        }

        public void TakeLoan(long amount, int months)
        {
            funds += amount;
            debt += (long)(amount * 1.18);
            Debug.Log($"[CitySim] 贷款到手 ¥{amount:N0}，负债 ¥{debt:N0}（{months} 期）");
        }

        // ---- 建筑升级 ----
        const int UpgradeInterval = 1024;

        public void TryUpgrade(int frame)
        {
            if (frame % UpgradeInterval != 0 || landPrice < 55f) return;
            float chance = (landPrice - 50f) / 200f;
            int upgraded = 0;
            for (int r = 0; r < GridMap.Size && upgraded < 3; r++)
            {
                for (int c = 0; c < GridMap.Size && upgraded < 3; c++)
                {
                    var cell = map.Cells[r, c];
                    if (cell.kind != TileKind.Residential && cell.kind != TileKind.Commercial) continue;
                    if (cell.built < 1f - 1e-4f) continue;
                    if (cell.level >= 2) continue;
                    var rng = new System.Random(unchecked(r * 73856093 ^ c * 19349663 ^ frame));
                    if (rng.NextDouble() >= chance) continue;
                    cell.level++;
                    map.Cells[r, c] = cell;
                    upgraded++;
                }
            }
        }

        // ---- 市民 ----
        void AdvanceCitizensStep()
        {
            if (citizens.agents.Count == 0) return;
            // 每 64 帧轻量更新一次通勤与幸福（重活放在年度结算）
        }

        void SettleYear()
        {
            atYear = clock.Year;

            // 灾难
            CheckDisaster();

            // 市民推进
            citizens.AdvanceYear(
                year: atYear,
                schoolCoverage: 0.6f,
                clinicCoverage: 0.5f,
                pollution: pollution * 100f,
                avgCommute: avgCommute,
                jobOpenings: jobs);

            Recompute();

            // 统计
            stats.Add(new YearRecord
            {
                year = atYear,
                population = population,
                jobs = jobs,
                funds = funds,
                happiness = happiness,
                congestion = congestion,
                pollution = pollution,
                avgCommute = avgCommute,
                taxIncome = dayIncome,
                upkeep = dayExpense,
            });
        }

        void CheckDisaster()
        {
            var candidates = new List<Vector2Int>();
            float density = Mathf.Clamp01(buildings / 1500f);
            for (int r = 0; r < GridMap.Size; r++)
            for (int c = 0; c < GridMap.Size; c++)
            {
                var cell = map.Cells[r, c];
                if (cell.kind == TileKind.Empty) continue;
                candidates.Add(new Vector2Int(r, c));
            }
            bool riverNear = map.HasRiver();
            if (DisasterSystem.TryRoll(map.seed, atYear, 0.35f, riverNear, density, candidates, out var d))
            {
                lastDisaster = d.Label;
                lastDisasterR = d.r;
                lastDisasterC = d.c;
                disasterPenalty = d.happinessDelta;
                var cell = map.Cells[d.r, d.c];
                cell.built = 0f;
                cell.occupancy = 0f;
                map.Cells[d.r, d.c] = cell;
                Debug.Log($"[Disaster] {d.Label} @({d.r},{d.c}) 幸福 {d.happinessDelta}");
            }
        }

        // ---- 存档辅助 ----
        public void ApplySaveData(Gotc.Save.SaveData data)
        {
            funds = data.funds;
            taxRate = data.taxRate;
            landPrice = data.landPrice;
            population = data.population;
            jobs = data.jobs;
            buildings = data.buildings;
            actualResidential = data.actualResidential;
            actualCommercial = data.actualCommercial;
            actualWorkplace = data.actualWorkplace;
            displayedResidential = data.displayedResidential;
            displayedCommercial = data.displayedCommercial;
            displayedWorkplace = data.displayedWorkplace;
            dayIncome = data.dayIncome;
            dayExpense = data.dayExpense;
            debt = data.debt;
            lastDisaster = data.lastDisaster;
            lastDisasterR = data.lastDisasterR;
            lastDisasterC = data.lastDisasterC;
            disasterPenalty = data.disasterPenalty;
            atYear = data.atYear;
            _lastYear = atYear;

            if (data.cells != null && data.cells.Length == GridMap.Size * GridMap.Size)
            {
                int i = 0;
                for (int r = 0; r < GridMap.Size; r++)
                for (int c = 0; c < GridMap.Size; c++)
                {
                    var dto = data.cells[i++];
                    var cell = map.Cells[r, c];
                    cell.terrain = (Terrain)dto.terrain;
                    cell.kind = (TileKind)dto.kind;
                    cell.level = (byte)dto.level;
                    cell.built = dto.built;
                    cell.occupancy = dto.occupancy;
                    map.Cells[r, c] = cell;
                }
            }

            if (data.agents != null)
            {
                var agents = new CitizenPool.Agent[data.agents.Length];
                for (int k = 0; k < agents.Length; k++)
                {
                    var d = data.agents[k];
                    agents[k] = new CitizenPool.Agent
                    {
                        cid = d.cid, age = d.age, education = d.education,
                        happiness = d.happiness, commute = d.commute, employed = d.employed,
                    };
                }
                citizens.Restore(agents, data.citizenPopulation);
            }

            if (data.policies != null)
            {
                cityPolicies.Clear();
                foreach (int p in data.policies) cityPolicies.Add((PolicyKey)p);
                RefreshPolicies();
            }

            if (data.districts != null)
            {
                districts.districts.Clear();
                foreach (var d in data.districts)
                {
                    var dist = new District { id = d.id, name = d.name };
                    foreach (int cellIdx in d.cells) dist.cells.Add(cellIdx);
                    districts.districts.Add(dist);
                }
            }

            if (data.transit != null)
            {
                transit.lines.Clear();
                foreach (var t in data.transit)
                {
                    var line = new TransitLine
                    {
                        id = t.id, name = t.name, kind = (TransitKind)t.kind, price = t.price,
                    };
                    line.cells.AddRange(t.cells);
                    transit.lines.Add(line);
                }
            }

            RefreshDemand();
            Recompute();
        }
    }
}

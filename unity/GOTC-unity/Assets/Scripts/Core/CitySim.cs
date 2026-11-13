using UnityEngine;

namespace Gotc.Core
{
    /// <summary>
    /// 城市模拟内核 —— 从 Web 版 backend/app/core/city.py 移植。
    ///
    /// 三条与 C:S 对齐的规则：
    ///   1. 建造闸门：每 8 帧最多落成一栋（C:S ZoneManager.cs:910-937）。
    ///   2. 需求双轨：真值驱动建造，显示值缓慢跟随（C:S 的 m_actual* 与 m_*Demand）。
    ///   3. 经济按日结算：256 帧 = 1 预算日（C:S EconomyManager 的 16 段 × 16 帧）。
    /// </summary>
    public sealed class CitySim : MonoBehaviour
    {
        public GridMap map;
        public SimClock clock;

        [Header("经济")]
        public long funds = 5_000_000;
        public float taxRate = 9f;
        public float landPrice = 1.0f;

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

        const int GateInterval = 8;
        const float BuildPerFrame = 0.05f;
        const float DemandSmooth = 0.10f;
        const float MigrationLimit = 0.08f;

        int _lastGateWindow = -1;

        void Awake()
        {
            if (clock != null) clock.Stepped += OnStep;
        }

        void OnDestroy()
        {
            if (clock != null) clock.Stepped -= OnStep;
        }

        void OnStep(int subStep)
        {
            if (subStep == 0) return;               // 暂停：只刷新，不推进模拟

            uint frame = clock.Frame;

            if (frame % 16 == 0) RefreshDemand();
            SmoothDemand();

            if (CanBuild(frame)) TryBuild(frame);

            TryUpgrade((int)frame);          // C:S：每 1024 帧查一次地价驱动升级

            if (frame % 256 == 0)
            {
                Recompute();
                SettleDay();
            }
        }

        /// <summary>C:S 的全局建造闸门：同一 8 帧窗口只放行一次。</summary>
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

            // 在未建成的住宅地块里挑一块
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

        void RefreshDemand()
        {
            int capacity = 0, occupied = 0, commercialCapacity = 0;
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
                else commercialCapacity += Mathf.RoundToInt(cap * cell.built);
            }

            population = occupied;
            jobs = commercialCapacity;

            // 需求 = 空置率（与 Web 版一致：满员转负）
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

        void Recompute()
        {
            landPrice = Mathf.Clamp(1f + population / 6000f, 0.8f, 4f);
        }

        static int CapacityOf(TileKind kind, int level) => kind switch
        {
            TileKind.Residential => level == 0 ? 300 : level == 1 ? 900 : 2400,
            TileKind.Commercial => 200,
            TileKind.Industrial => 350,
            _ => 0
        };

        // ---- 财政（对齐 C:S EconomyManager 的日结算 + 贷款分摊） ----
        public long dayIncome;
        public long dayExpense;
        public long debt;
        long _lastSettleDay;

        public void SettleDay()
        {
            dayIncome = (long)(population * taxRate * 12.0);
            dayExpense = (long)(buildings * 45.0);
            funds += dayIncome - dayExpense;
            if (debt > 0 && _lastSettleDay > 0 && _lastSettleDay % 30 == 0)
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


        // ---- 建筑升级：对齐 C:S 的「地价驱动升级」（地价 55 → 2.5%，100 → 25%） ----
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
                    if (cell.built < 0.999f || cell.level >= 2) continue;
                    if (Random.value >= chance) continue;
                    cell.level++;
                    map.Cells[r, c] = cell;
                    upgraded++;
                }
            }
            if (upgraded > 0)
            {
                map.NotifyChanged();
                Debug.Log($"[CitySim] 地价 {landPrice:F0} 升级 {upgraded} 栋");
            }
        }

    }
}

using System.Collections.Generic;
using UnityEngine;

namespace Gotc.Core
{
    public enum TransitKind { Bus, Metro }

    [System.Serializable]
    public class TransitLine
    {
        public int id;
        public string name;
        public TransitKind kind;
        public readonly List<int> cells = new List<int>();
        public Color color = new Color(0.24f, 0.55f, 1f);
        public float price = 2f;
        public int passengers;
        public int stops => cells.Count;
    }

    /// <summary>
    /// 公交/地铁线路（对齐 C:S 的 TransitLine）。
    /// 站点必须是 Road 格；同一线路 >= 2 站才成立。
    /// </summary>
    public class TransitManager
    {
        public const int MaxLines = 64;
        public const int MaxStopsPerLine = 32;
        public const float CellMeter = 50f;
        public const float WalkToStopM = 600f;

        public readonly List<TransitLine> lines = new List<TransitLine>();
        int _nextId;

        public static float MinutesPerStop(TransitKind k) => k == TransitKind.Bus ? 2f : 1.2f;
        public static long Cost(TransitKind k) => k == TransitKind.Bus ? 60_000L : 240_000L;
        public static float MaxPrice(TransitKind k) => k == TransitKind.Bus ? 3f : 6f;

        public TransitLine Create(string name, TransitKind kind, List<int> stopCells)
        {
            if (lines.Count >= MaxLines) return null;
            if (stopCells == null || stopCells.Count < 2 || stopCells.Count > MaxStopsPerLine) return null;
            var l = new TransitLine
            {
                id = _nextId++,
                name = string.IsNullOrWhiteSpace(name) ? $"{kind} {lines.Count + 1}" : name,
                kind = kind,
            };
            l.cells.AddRange(stopCells);
            lines.Add(l);
            return l;
        }

        public bool AddStop(int id, int cell)
        {
            var l = lines.Find(x => x.id == id);
            if (l == null || l.cells.Count >= MaxStopsPerLine) return false;
            if (!l.cells.Contains(cell)) l.cells.Add(cell);
            return true;
        }

        public bool Delete(int id) => lines.RemoveAll(x => x.id == id) > 0;

        public bool SetPrice(int id, float price)
        {
            var l = lines.Find(x => x.id == id);
            if (l == null) return false;
            l.price = Mathf.Clamp(price, 0f, MaxPrice(l.kind));
            return true;
        }

        /// <summary>两点都有同线站点（600m 内）时的乘车时间，否则 -1。</summary>
        public float RideMinutes(int fromCell, int toCell)
        {
            if (fromCell == toCell) return -1f;
            float best = -1f;
            foreach (var l in lines)
            {
                int a = NearestStop(l, fromCell);
                int b = NearestStop(l, toCell);
                if (a < 0 || b < 0 || a == b) continue;
                int span = Mathf.Abs(a - b);
                float t = 2f * (WalkToStopM / 5000f * 60f) + span * MinutesPerStop(l.kind);
                if (best < 0f || t < best) best = t;
            }
            return best;
        }

        int NearestStop(TransitLine l, int cell)
        {
            int cr = cell / GridMap.Size, cc = cell % GridMap.Size;
            int best = -1;
            float bestD = WalkToStopM / CellMeter;
            for (int i = 0; i < l.cells.Count; i++)
            {
                int r = l.cells[i] / GridMap.Size, c = l.cells[i] % GridMap.Size;
                float d = Mathf.Abs(r - cr) + Mathf.Abs(c - cc);
                if (d <= bestD) { bestD = d; best = i; }
            }
            return best;
        }

        public float CoverageRatio(List<int> homes, List<int> jobs, GridMap map)
        {
            if (homes.Count == 0 || jobs.Count == 0) return 0f;
            int served = 0, total = 0;
            foreach (var h in homes)
            {
                total++;
                foreach (var j in jobs)
                    if (RideMinutes(h, j) > 0f) { served++; break; }
            }
            return total == 0 ? 0f : (float)served / total;
        }
    }
}

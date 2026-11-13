using System.Collections.Generic;
using Gotc.Core;
using Gotc.Sim;
using UnityEngine;

namespace Gotc.UI
{
    /// <summary>
    /// 左侧图标坞 + 单面板（对齐 Web 版 SideDock 的交互）。
    ///
    /// 为什么用 IMGUI：这个原型要在没有 Canvas 层级、没有 UGUI 资源的情况下
    /// 直接 Play 就能跑。正式皮肤走 docs/plan/16-pixel-art-ui.md。
    /// </summary>
    public sealed class SideDock : MonoBehaviour
    {
        public CitySim sim;
        public SimClock clock;
        public GridMap map;
        public DistrictManager districts;
        public TransitManager transit;

        enum Tab { None, Budget, Citizens, Districts, Transit, Stats, Policies, Milestone }

        Tab _open = Tab.None;
        Vector2 _scroll;
        bool _budgetOpen = true;

        static readonly (Tab tab, string icon, string label)[] Tabs =
        {
            (Tab.Budget,   "¥", "财政"),
            (Tab.Citizens, "人", "市民"),
            (Tab.Districts,"区", "行政区"),
            (Tab.Transit,  "车", "线路"),
            (Tab.Stats,    "图", "统计"),
            (Tab.Policies, "法", "政策"),
            (Tab.Milestone,"★", "里程碑"),
        };

        GUIStyle _btn, _btnOn, _h, _label, _small;

        void EnsureStyles()
        {
            if (_btn != null) return;
            _btn = new GUIStyle(GUI.skin.button) { fontSize = 18, alignment = TextAnchor.MiddleCenter };
            _btnOn = new GUIStyle(_btn);
            _btnOn.normal.textColor = Color.green;
            _h = new GUIStyle(GUI.skin.label) { fontSize = 16, fontStyle = FontStyle.Bold };
            _label = new GUIStyle(GUI.skin.label) { fontSize = 13 };
            _small = new GUIStyle(GUI.skin.label) { fontSize = 11, wordWrap = true };
        }

        void OnGUI()
        {
            if (sim == null) return;
            EnsureStyles();
            DrawDock();
            if (_open == Tab.None) return;

            var panel = new Rect(72, 68, 340, Screen.height - 130);
            GUI.Box(panel, GUIContent.none);
            GUILayout.BeginArea(new Rect(panel.x + 10, panel.y + 8, panel.width - 20, panel.height - 16));
            _scroll = GUILayout.BeginScrollView(_scroll);

            switch (_open)
            {
                case Tab.Budget: DrawBudget(); break;
                case Tab.Citizens: DrawCitizens(); break;
                case Tab.Districts: DrawDistricts(); break;
                case Tab.Transit: DrawTransit(); break;
                case Tab.Stats: DrawStats(); break;
                case Tab.Policies: DrawPolicies(); break;
                case Tab.Milestone: DrawMilestone(); break;
            }

            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        void DrawDock()
        {
            float y = 68;
            foreach (var (tab, icon, label) in Tabs)
            {
                var rect = new Rect(12, y, 52, 44);
                var style = _open == tab ? _btnOn : _btn;
                if (GUI.Button(rect, new GUIContent(icon, label), style))
                {
                    _open = _open == tab ? Tab.None : tab;
                    _scroll = Vector2.zero;
                }
                GUI.Label(new Rect(12, y + 44, 52, 14), label, _small);
                y += 62;
            }
        }

        // ---- 财政 ----
        void DrawBudget()
        {
            GUILayout.Label("财政", _h);
            GUILayout.Label($"资金  ¥{sim.funds:N0}", _label);
            GUILayout.Label($"日收入 ¥{sim.dayIncome:N0}   日支出 ¥{sim.dayExpense:N0}", _label);
            GUILayout.Label($"日结余 ¥{(sim.dayIncome - sim.dayExpense):N0}   负债 ¥{sim.debt:N0}", _label);
            GUILayout.Space(6);
            GUILayout.Label($"住宅税率 {sim.taxRate:F0}%", _label);
            sim.taxRate = Mathf.Round(GUILayout.HorizontalSlider(sim.taxRate, 1f, 29f));
            GUILayout.Space(6);
            if (GUILayout.Button("贷款 ¥10万 · 60 期")) sim.TakeLoan(100_000, 60);
        }

        // ---- 市民 ----
        void DrawCitizens()
        {
            var c = sim.citizens;
            GUILayout.Label("市民", _h);
            GUILayout.Label($"人口 {c.population:N0}   抽样 {c.Count} 人", _label);
            GUILayout.Label($"每人代表 {c.scale:F1} 人", _small);
            GUILayout.Space(6);
            GUILayout.Label($"平均年龄 {c.AvgAge:F1}", _label);
            GUILayout.Label($"就业率 {c.EmploymentRate:P0}", _label);
            GUILayout.Label($"平均幸福 {c.AvgHappiness:F0}", _label);
            GUILayout.Space(6);
            GUILayout.Label("年龄结构", _label);
            var ages = c.AgeDistribution();
            string[] ageLabels = { "0-14", "15-29", "30-44", "45-59", "60+" };
            for (int i = 0; i < ages.Length; i++)
            {
                GUILayout.BeginHorizontal();
                GUILayout.Label(ageLabels[i], _small, GUILayout.Width(48));
                var r = GUILayoutUtility.GetRect(180, 12);
                Bar(r, ages[i], new Color(0.45f, 0.75f, 0.95f));
                GUILayout.Label($"{ages[i]:P0}", _small);
                GUILayout.EndHorizontal();
            }
            GUILayout.Space(6);
            GUILayout.Label("教育结构", _label);
            var edu = c.EducationDistribution();
            string[] eduLabels = { "未受教育", "小学", "中学", "大学" };
            for (int i = 0; i < edu.Length; i++)
            {
                GUILayout.BeginHorizontal();
                GUILayout.Label(eduLabels[i], _small, GUILayout.Width(48));
                var r = GUILayoutUtility.GetRect(180, 12);
                Bar(r, edu[i], new Color(0.35f, 0.85f, 0.55f));
                GUILayout.Label($"{edu[i]:P0}", _small);
                GUILayout.EndHorizontal();
            }
        }

        // ---- 行政区 ----
        void DrawDistricts()
        {
            GUILayout.Label("行政区", _h);
            GUILayout.Label($"共 {districts.districts.Count} 个区（上限 256）", _small);
            if (GUILayout.Button("把当前选区设为行政区")) { /* 由 BuildingPlacer 的选区驱动 */ }
            GUILayout.Space(6);
            foreach (var d in districts.districts)
            {
                GUILayout.Label($"{d.name} · {d.cells.Count} 格", _label);
            }
        }

        // ---- 公交 ----
        void DrawTransit()
        {
            GUILayout.Label("公交 / 地铁", _h);
            GUILayout.Label($"共 {transit.lines.Count} 条线（上限 64）", _small);
            GUILayout.Space(4);
            if (GUILayout.Button("新建公交线（需先铺道路）"))
            {
                var stops = new List<int>();
                for (int r = 0; r < GridMap.Size && stops.Count < 8; r += 6)
                for (int c = 0; c < GridMap.Size && stops.Count < 8; c += 6)
                    if (map.Cells[r, c].kind == TileKind.Road) stops.Add(r * GridMap.Size + c);
                if (stops.Count >= 2) transit.Create("公交 1", TransitKind.Bus, stops);
            }
            GUILayout.Space(6);
            foreach (var line in transit.lines)
            {
                GUILayout.Label($"{line.name}（{(line.kind == TransitKind.Bus ? "公交" : "地铁")}）· {line.stops} 站 · ¥{line.price:F1}", _label);
            }
        }

        // ---- 统计 ----
        void DrawStats()
        {
            GUILayout.Label("逐年统计", _h);
            var recs = sim.stats.records;
            if (recs.Count == 0) { GUILayout.Label("还没有完整年度的数据", _small); return; }
            GUILayout.Label($"最近 {recs.Count} 年", _small);
            GUILayout.Space(4);

            DrawSeries("人口", recs, r => r.population, new Color(0.35f, 0.85f, 0.45f));
            DrawSeries("岗位", recs, r => r.jobs, new Color(0.35f, 0.65f, 0.95f));
            DrawSeries("幸福", recs, r => (int)r.happiness, new Color(0.95f, 0.55f, 0.65f));
            DrawSeries("通勤", recs, r => r.avgCommute, new Color(0.95f, 0.78f, 0.32f));
        }

        void DrawSeries(string title, List<YearRecord> recs, System.Func<YearRecord, int> pick, Color color)
        {
            GUILayout.Label(title, _label);
            var rect = GUILayoutUtility.GetRect(300, 46);
            GUI.DrawTexture(rect, Texture2D.whiteTexture, ScaleMode.StretchToFill, false, 0, new Color(0, 0, 0, 0.18f), 0, 0);
            int max = 1;
            foreach (var rec in recs) max = Mathf.Max(max, pick(rec));
            var prev = Vector2.zero;
            for (int i = 0; i < recs.Count; i++)
            {
                float x = rect.x + rect.width * i / Mathf.Max(1, recs.Count - 1);
                float y = rect.yMax - rect.height * Mathf.Clamp01((float)pick(recs[i]) / max);
                var p = new Vector2(x, y);
                if (i > 0) DrawLine(prev, p, color);
                prev = p;
            }
            GUILayout.Label($"  最小 0 · 最大 {max:N0}", _small);
        }

        static void DrawLine(Vector2 a, Vector2 b, Color color)
        {
            var old = GUI.color;
            GUI.color = color;
            float len = Vector2.Distance(a, b);
            float angle = Mathf.Atan2(b.y - a.y, b.x - a.x) * Mathf.Rad2Deg;
            var m = GUI.matrix;
            GUIUtility.RotateAroundPivot(angle, a);
            GUI.DrawTexture(new Rect(a.x, a.y, len, 1.5f), Texture2D.whiteTexture);
            GUI.matrix = m;
            GUI.color = old;
        }

        // ---- 政策 ----
        void DrawPolicies()
        {
            GUILayout.Label("城市政策", _h);
            foreach (var def in CityPolicies.All)
            {
                bool on = sim.cityPolicies.Contains(def.key);
                if (GUILayout.Button($"{(on ? "✓ " : "")}{def.label}", _label))
                    sim.TogglePolicy(def.key);
                GUILayout.Label(def.desc, _small);
                GUILayout.Space(4);
            }
        }

        // ---- 里程碑 ----
        void DrawMilestone()
        {
            var cur = Milestones.Current(sim.population);
            GUILayout.Label("里程碑", _h);
            GUILayout.Label($"当前档位：T{cur.tier} {cur.label}", _label);
            GUILayout.Label($"人口门槛 {cur.population:N0}", _small);
            GUILayout.Space(6);
            GUILayout.Label("已解锁", _label);
            foreach (var u in cur.unlocks) GUILayout.Label($"· {u}", _small);
            GUILayout.Space(6);
            if (Milestones.HasNext(sim.population, out var next, out float progress))
            {
                GUILayout.Label($"下一档：T{next.tier} {next.label}（{next.population:N0}）", _label);
                var r = GUILayoutUtility.GetRect(300, 12);
                Bar(r, progress, new Color(0.95f, 0.78f, 0.32f));
                GUILayout.Label($"还差 {Mathf.Max(0, next.population - sim.population):N0} 人", _small);
            }
            else
            {
                GUILayout.Label("已到最高档位", _label);
            }
            GUILayout.Space(8);
            var w = sim.weather;
            GUILayout.Label($"天气：{w.SeasonLabel} · {w.Icon} {w.Label} {w.temperature:F0}°C", _label);
            if (!string.IsNullOrEmpty(sim.lastDisaster))
                GUILayout.Label($"上次灾难：{sim.lastDisaster}", _label);
        }

        static void Bar(Rect rect, float value, Color color)
        {
            GUI.DrawTexture(rect, Texture2D.whiteTexture, ScaleMode.StretchToFill, false, 0, new Color(1, 1, 1, 0.18f), 0, 0);
            var fill = new Rect(rect.x, rect.y, rect.width * Mathf.Clamp01(value), rect.height);
            GUI.DrawTexture(fill, Texture2D.whiteTexture, ScaleMode.StretchToFill, false, 0, color, 0, 0);
        }
    }
}

using UnityEngine;
using Gotc.Core;

namespace Gotc.UI
{
    /// <summary>财政面板：对齐 C:S 的 EconomyManager（收支 / 税率 / 贷款）。</summary>
    public sealed class BudgetHud : MonoBehaviour
    {
        public CitySim sim;
        bool _open;

        void OnGUI()
        {
            if (sim == null) return;
            var style = new GUIStyle(GUI.skin.box) { alignment = TextAnchor.UpperLeft, fontSize = 13, padding = new RectOffset(10, 10, 8, 8) };

            var rect = new Rect(12, 176, 230, _open ? 176 : 40);
            GUI.Box(rect, GUIContent.none, style);
            GUI.Label(new Rect(rect.x + 10, rect.y + 8, 150, 22), $"财政 ¥{sim.funds:N0}");
            if (GUI.Button(new Rect(rect.x + rect.width - 52, rect.y + 8, 42, 22), _open ? "收起" : "展开"))
                _open = !_open;
            if (!_open) return;

            float y = rect.y + 38;
            GUI.Label(new Rect(rect.x + 10, y, 210, 20), $"日收入 ¥{sim.dayIncome:N0}  日支出 ¥{sim.dayExpense:N0}");
            y += 24;
            GUI.Label(new Rect(rect.x + 10, y, 210, 20), $"住宅税率 {sim.taxRate:F1}%");
            y += 24;
            sim.taxRate = GUI.HorizontalSlider(new Rect(rect.x + 10, y + 4, 210, 18), sim.taxRate, 1f, 29f);
            y += 30;
            if (GUI.Button(new Rect(rect.x + 10, y, 210, 24), "贷款 ¥10万 · 60 期"))
                sim.TakeLoan(100_000, 60);
        }
    }
}

using UnityEngine;
using Gotc.Core;

namespace Gotc.UI
{
    /// <summary>信息视图：对齐 C:S 的 InfoManager（地价 / 污染 / 交通 / 幸福 / 就业）。</summary>
    public enum InfoView { Default, LandPrice, Pollution, Traffic, Happiness, Employment }

    public sealed class InfoViewController : MonoBehaviour
    {
        public GridRenderer gridRenderer;
        public CitySim sim;

        public InfoView view = InfoView.Default;

        static readonly InfoView[] Cycle =
        {
            InfoView.Default, InfoView.LandPrice, InfoView.Pollution,
            InfoView.Traffic, InfoView.Happiness, InfoView.Employment,
        };

        void Update()
        {
            if (Input.GetKeyDown(KeyCode.Tab))
            {
                int i = System.Array.IndexOf(Cycle, view);
                view = Cycle[(i + 1) % Cycle.Length];
                Apply();
            }
            for (int k = 0; k < Cycle.Length; k++)
            {
                if (Input.GetKeyDown(KeyCode.F1 + k)) { view = Cycle[k]; Apply(); }
            }
        }

        public void Apply()
        {
            if (gridRenderer != null) gridRenderer.infoView = view;
            Debug.Log($"[InfoView] {view}");
        }

        /// <summary>把 0..1 的指标映射成绿→黄→红。</summary>
        public static Color Heat(float v)
        {
            v = Mathf.Clamp01(v);
            if (v < 0.5f) return Color.Lerp(new Color(0.30f, 0.82f, 0.42f), new Color(0.98f, 0.85f, 0.25f), v * 2f);
            return Color.Lerp(new Color(0.98f, 0.85f, 0.25f), new Color(0.92f, 0.28f, 0.26f), (v - 0.5f) * 2f);
        }
    }
}

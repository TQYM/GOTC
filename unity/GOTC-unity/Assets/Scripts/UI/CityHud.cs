using Gotc.Core;
using UnityEngine;

namespace Gotc.UI
{
    /// <summary>
    /// 最小 HUD：资金、人口、时间、速度档、需求条。
    /// 用 IMGUI 是为了让这个原型不依赖 Canvas 层级配置，Editor 一打开就能跑。
    /// 正式版会换成 UGUI + 像素风皮肤（见 docs/plan/16-pixel-art-ui.md）。
    /// </summary>
    public sealed class CityHud : MonoBehaviour
    {
        public SimClock clock;
        public GridMap map;
        public CitySim sim;

        GUIStyle _label;

        void EnsureStyle()
        {
            if (_label != null) return;
            _label = new GUIStyle(GUI.skin.label) { fontSize = 15, richText = true };
        }

        void OnGUI()
        {
            EnsureStyle();
            var bar = new Rect(12, 12, 330, 152);
            GUI.Box(bar, GUIContent.none);

            long funds = sim != null ? sim.funds : 0L;
            int population = sim != null ? sim.population : 0;
            GUI.Label(new Rect(22, 18, 310, 22), $"<b>资金</b>  ¥{funds:N0}", _label);
            GUI.Label(new Rect(22, 40, 310, 22), $"<b>人口</b>  {population:N0}    <b>岗位</b> {(sim != null ? sim.jobs : 0):N0}", _label);
            GUI.Label(new Rect(22, 62, 310, 22), clock != null ? $"<b>时间</b>  {clock.Now}" : "", _label);

            string speed = clock == null ? "-" : clock.Paused ? "❚❚ 暂停" : $"▶ {clock.Speed}x";
            GUI.Label(new Rect(22, 84, 310, 22), $"<b>速度</b>  {speed}", _label);

            if (clock != null)
            {
                if (GUI.Button(new Rect(22, 122, 52, 22), "暂停")) clock.SetSpeed(0);
                if (GUI.Button(new Rect(80, 122, 40, 22), "1x")) clock.SetSpeed(1);
                if (GUI.Button(new Rect(126, 122, 40, 22), "2x")) clock.SetSpeed(2);
                if (GUI.Button(new Rect(172, 122, 40, 22), "3x")) clock.SetSpeed(3);
            }

            // 需求条：住宅绿 / 商业蓝 / 工业黄
            var r = new Rect(Screen.width - 96, 12, 84, 152);
            GUI.Box(r, GUIContent.none);
            float demandR = sim != null ? sim.displayedResidential : 0f;
            float demandC = sim != null ? sim.displayedCommercial : 0f;
            float demandI = sim != null ? sim.displayedWorkplace : 0f;
            DrawBar(new Rect(r.x + 8, r.y + 10, 18, 132), demandR, new Color(0.35f, 0.85f, 0.45f));
            DrawBar(new Rect(r.x + 34, r.y + 10, 18, 132), demandC, new Color(0.35f, 0.65f, 0.95f));
            DrawBar(new Rect(r.x + 60, r.y + 10, 18, 132), demandI, new Color(0.95f, 0.78f, 0.32f));
        }

        static void DrawBar(Rect rect, float value, Color color)
        {
            var old = GUI.color;
            GUI.color = new Color(1f, 1f, 1f, 0.25f);
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = color;
            float h = Mathf.Clamp01(value) * rect.height;
            GUI.DrawTexture(new Rect(rect.x, rect.yMax - h, rect.width, h), Texture2D.whiteTexture);
            GUI.color = old;
        }
    }
}

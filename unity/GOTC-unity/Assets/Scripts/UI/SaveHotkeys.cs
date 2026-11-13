using Gotc.Core;
using Gotc.Save;
using UnityEngine;

namespace Gotc.UI
{
    /// <summary>
    /// 存档热键：F5 保存、F9 读取、F10 新建（重生成地图）。
    /// 存到 Application.persistentDataPath/saves/quicksave.json。
    ///
    /// 为什么不做多槽位 UI：这一版先把「关掉不丢」解决掉，
    /// 多槽位等 UGUI 皮肤落地后一起做。
    /// </summary>
    public sealed class SaveHotkeys : MonoBehaviour
    {
        public const string Slot = "quicksave";

        public CitySim sim;
        public GridMap map;
        public SimClock clock;

        string _toast;
        float _toastUntil;

        void Update()
        {
            if (Input.GetKeyDown(KeyCode.F5)) DoSave();
            if (Input.GetKeyDown(KeyCode.F9)) DoLoad();
            if (Input.GetKeyDown(KeyCode.F10)) DoNew();
        }

        void DoSave()
        {
            if (sim == null || map == null || clock == null) return;
            var data = SaveMapper.Capture(
                sim, map, clock,
                sim.citizens, sim.districts, sim.transit,
                sim.weather, sim.stats, sim.cityPolicies);
            bool ok = SaveSystem.Save(Slot, data);
            Show(ok ? "已保存" : "保存失败");
        }

        void DoLoad()
        {
            var data = SaveSystem.Load(Slot);
            if (data == null) { Show("没有找到存档"); return; }
            sim.ApplySaveData(data);
            clock.Restore(data.frame, data.speed);
            Show($"已读取（{data.savedAt}）");
        }

        void DoNew()
        {
            map.Generate(map.seed);
            sim.ApplySaveData(new SaveData());
            clock.Restore(0, 0);
            Show("新城市");
        }

        void Show(string msg)
        {
            _toast = msg;
            _toastUntil = Time.time + 2.5f;
            Debug.Log($"[Save] {msg}");
        }

        void OnGUI()
        {
            if (_toast == null || Time.time > _toastUntil) return;
            var style = new GUIStyle(GUI.skin.label) { fontSize = 16, alignment = TextAnchor.MiddleCenter };
            GUI.Label(new Rect(0, Screen.height - 60, Screen.width, 24), _toast, style);
        }
    }
}

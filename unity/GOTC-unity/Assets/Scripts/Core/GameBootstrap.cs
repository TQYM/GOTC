using Gotc.Building;
using Gotc.CameraRig;
using Gotc.UI;
using UnityEngine;

namespace Gotc.Core
{
    /// <summary>
    /// 无场景启动：打开工程直接 Play 就能看到 48×48 沙盘。
    /// 所有对象都在运行时建出来，避免依赖 .unity 场景文件（那些必须由 Editor 生成）。
    /// </summary>
    public static class GameBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Boot()
        {
            if (Object.FindFirstObjectByType<GridMap>() != null) return;

            var root = new GameObject("CITY20-Root");

            var mapGo = new GameObject("GridMap");
            mapGo.transform.SetParent(root.transform);
            var map = mapGo.AddComponent<GridMap>();

            var renderGo = new GameObject("GridRenderer");
            renderGo.transform.SetParent(root.transform);
            renderGo.AddComponent<MeshFilter>();
            renderGo.AddComponent<MeshRenderer>();
            var gridRenderer = renderGo.AddComponent<GridRenderer>();
            gridRenderer.map = map;

            var camGo = new GameObject("MainCamera");
            camGo.tag = "MainCamera";
            camGo.transform.SetParent(root.transform);
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.55f, 0.78f, 0.92f);
            cam.fieldOfView = 45f;
            camGo.AddComponent<AudioListener>();
            camGo.transform.position = new Vector3(0f, 40f, -40f);
            camGo.transform.LookAt(Vector3.zero);
            camGo.AddComponent<RtsCamera>();

            var lightGo = new GameObject("Sun");
            lightGo.transform.SetParent(root.transform);
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.15f;
            light.color = new Color(1f, 0.96f, 0.88f);
            lightGo.transform.rotation = Quaternion.Euler(52f, -35f, 0f);

            var clockGo = new GameObject("SimClock");
            clockGo.transform.SetParent(root.transform);
            var clockComponent = clockGo.AddComponent<SimClockBehaviour>();
            var clock = clockComponent.clock;

            var placerGo = new GameObject("BuildingPlacer");
            placerGo.transform.SetParent(root.transform);
            var placer = placerGo.AddComponent<BuildingPlacer>();
            placer.map = map;

            var simGo = new GameObject("CitySim");
            simGo.transform.SetParent(root.transform);
            var sim = simGo.AddComponent<CitySim>();
            sim.map = map;
            sim.clock = clock;

            var brushGo = new GameObject("ZoneBrush");
            brushGo.transform.SetParent(root.transform);
            var brush = brushGo.AddComponent<ZoneBrush>();
            brush.map = map;
            brush.sim = sim;
            brush.cam = cam;

            gridRenderer.sim = sim;

            var infoGo = new GameObject("InfoView");
            infoGo.transform.SetParent(root.transform);
            var infoView = infoGo.AddComponent<InfoViewController>();
            infoView.gridRenderer = gridRenderer;
            infoView.sim = sim;

            var budgetGo = new GameObject("BudgetHud");
            budgetGo.transform.SetParent(root.transform);
            var budgetHud = budgetGo.AddComponent<BudgetHud>();
            budgetHud.sim = sim;

            var hudGo = new GameObject("CityHud");
            hudGo.transform.SetParent(root.transform);
            var hud = hudGo.AddComponent<CityHud>();
            hud.clock = clock;
            hud.map = map;
            hud.sim = sim;
        }
    }

    /// <summary>把 SimClock 挂到 GameObject 上并驱动。</summary>
    public sealed class SimClockBehaviour : MonoBehaviour
    {
        public readonly SimClock clock = new SimClock();

        void Update() => clock.Tick();
    }
}

using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Gotc.EditorTools
{
    /// <summary>
    /// CI / 命令行出包入口：
    ///   Unity.exe -batchmode -nographics -quit -projectPath &lt;proj&gt; \
    ///            -executeMethod Gotc.EditorTools.BuildWindows.Build
    /// 工程没有预置 .unity 场景（靠 [RuntimeInitializeOnLoadMethod] 启动），
    /// 但 BuildPipeline 不接受空场景列表，所以这里自动生成一个空启动场景。
    /// </summary>
    public static class BuildWindows
    {
        const string SceneDir = "Assets/Scenes";
        const string ScenePath = SceneDir + "/Main.unity";

        [MenuItem("GOTC/Build Windows")]
        public static void Build()
        {
            string outDir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds", "Windows"));
            Directory.CreateDirectory(outDir);
            Debug.Log($"[Build] outDir={outDir}");

            EnsureScene();

            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = Path.Combine(outDir, "GOTC.exe"),
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.None,
            };

            BuildReport report = BuildPipeline.BuildPlayer(options);
            BuildSummary s = report.summary;
            Debug.Log($"[Build] result={s.result} size={s.totalSize} bytes errors={s.totalErrors} warnings={s.totalWarnings}");
            EditorApplication.Exit(s.result == BuildResult.Succeeded ? 0 : 1);
        }

        static void EnsureScene()
        {
            if (File.Exists(ScenePath))
            {
                return;
            }
            Directory.CreateDirectory(SceneDir);
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.Refresh();
            Debug.Log($"[Build] created {ScenePath}");
        }
    }
}

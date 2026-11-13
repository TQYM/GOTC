using System;
using System.IO;
using UnityEngine;

namespace Gotc.Core
{
    /// <summary>
    /// 游戏内截图：F12 手动截，启动 18 秒后自动截一张。
    ///
    /// 为什么要这个：台式机桌面上有个 topmost 的黑色控制台窗口（C:\WINDOWS\System32\Winc），
    /// 用 schtasks + Win32 截图永远会被它挡住中央。ScreenCapture 从渲染管线直接读帧，
    /// 绕过桌面合成，能拿到完整画面。
    /// </summary>
    public sealed class AutoScreenshot : MonoBehaviour
    {
        public float autoAfterSeconds = 18f;

        string Dir => Path.Combine(Application.persistentDataPath, "shots");
        bool _done;

        void Update()
        {
            if (!_done && Time.timeSinceLevelLoad >= autoAfterSeconds)
            {
                _done = true;
                Capture("auto");
            }
            if (Input.GetKeyDown(KeyCode.F12)) Capture("manual");
        }

        void Capture(string tag)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                string name = $"{tag}-{DateTime.Now:HHmmss}.png";
                ScreenCapture.CaptureScreenshot(Path.Combine(Dir, name));
                Debug.Log($"[Shot] {Path.Combine(Dir, name)}");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Shot] 失败: {e.Message}");
            }
        }
    }
}

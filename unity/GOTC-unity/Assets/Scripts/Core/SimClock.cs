using System;
using UnityEngine;

namespace Gotc.Core
{
    /// <summary>
    /// 帧时钟 —— 对齐 Cities: Skylines 的 SimulationManager。
    ///
    /// C:S 的语义（官方源码 SimulationManager.cs:869-960）：
    ///   - 暂停时 finalSimulationSpeed = 0，但仍跑 subStep = 0 一遍（所以暂停时
    ///     信息视图、需求条还在动）——这里用 subStep 0 表示「只刷新 UI」。
    ///   - 1x / 2x / 3x 分别对应一 tick 内跑 1 / 2 / 4 帧（3x 实际是 4x，官方如此）。
    ///   - 每帧推进 147.65625 秒游戏时间。
    /// </summary>
    public sealed class SimClock
    {
        public const int FramesPerDay = 256;
        public const int FramesPerYear = 3600;
        public const float SecondsPerFrame = 147.65625f;

        /// <summary>C:S 的 3x 档实际按 4 帧算，这里保留同样的映射。</summary>
        static readonly int[] SpeedFrames = { 0, 1, 2, 4 };

        public uint Frame { get; private set; }
        public int Speed { get; private set; } = 1;   // 开局就跑，与 C:S 新城市默认速度一致

        public bool Paused => Speed == 0;
        public int Year => (int)(Frame / FramesPerYear) + 1;
        public int DayOfYear => (int)(Frame % FramesPerYear) / (FramesPerYear / 365) + 1;
        public float Hour => Frame % FramesPerDay / (float)FramesPerDay * 24f;
        public bool IsNight => Hour < 5f || Hour > 20f;

        public event Action<int> Stepped;   // 参数是 subStep

        /// <summary>存档读回：直接跳到某一帧与某一速度档。</summary>
        public void Restore(uint frame, int speed)
        {
            Frame = frame;
            Speed = Mathf.Clamp(speed, 0, 3);
        }

        public void SetSpeed(int speed)
        {
            Speed = Mathf.Clamp(speed, 0, 3);
            // 调速度自动取消暂停，和 C:S 的 SelectedSimulationSpeed setter 一致
        }

        /// <summary>主循环每 tick 调一次：按当前档位推进若干帧。</summary>
        public void Tick()
        {
            int n = SpeedFrames[Speed];
            if (n == 0)
            {
                Stepped?.Invoke(0);   // 暂停仍然走一次「只刷新」的 subStep
                return;
            }
            for (int i = 1; i <= n; i++)
            {
                Frame++;
                Stepped?.Invoke(i);
            }
        }

        public GameTime Now => new GameTime(Frame, Year, DayOfYear, Hour);
    }

    public readonly struct GameTime
    {
        public readonly uint Frame;
        public readonly int Year;
        public readonly int DayOfYear;
        public readonly float Hour;

        public GameTime(uint frame, int year, int dayOfYear, float hour)
        {
            Frame = frame; Year = year; DayOfYear = dayOfYear; Hour = hour;
        }

        public override string ToString() => $"{Year} 年 · 第 {DayOfYear} 天 · {(int)Hour:00}:00";
    }
}

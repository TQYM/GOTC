using System.Collections.Generic;
using UnityEngine;

namespace Gotc.Core
{
    public enum Terrain { Flat, Hill, Forest, River }
    public enum TileKind { Empty, Residential, Commercial, Industrial, Green, Civic, Road }

    [System.Serializable]
    public struct Cell
    {
        public Terrain terrain;
        public TileKind kind;
        public byte level;      // 0..3，住宅/商业的等级
        public float built;     // 0..1 建成度：C:S 的「划区 ≠ 建成」
        public float occupancy; // 0..1 入住率
    }

    /// <summary>
    /// 48×48 的方形沙盘。和 C:S 一样，格子是唯一的世界坐标单位：
    /// 位置一律用 (row, col)，不用 Vector3 —— 换地图、换缩放都不会让存档失效。
    /// </summary>
    public sealed class GridMap : MonoBehaviour
    {
        public const int Size = 48;
        public const float CellSize = 2f;

        /// <summary>地图种子：重新生成与存档都要用它（真实地块加载后会覆盖）。</summary>
        [SerializeField] public int seed = 20261107;

        public Cell[,] Cells { get; private set; } = new Cell[Size, Size];

        /// <summary>格子内容变化时通知渲染层重烘 mesh。</summary>
        public event System.Action Changed;

        public void NotifyChanged() => Changed?.Invoke();

        void Awake() => Generate(seed);

        public void Generate(int newSeed)
        {
            seed = newSeed;
            var rng = new System.Random(newSeed);
            for (int r = 0; r < Size; r++)
            for (int c = 0; c < Size; c++)
            {
                float n = Mathf.PerlinNoise((r + newSeed % 97) * 0.09f, (c + newSeed % 89) * 0.09f);
                Terrain t = n > 0.72f ? Terrain.Hill : n > 0.58f ? Terrain.Forest : Terrain.Flat;
                Cells[r, c] = new Cell { terrain = t };
            }
            // 一条斜向河道，给桥梁留出用途
            for (int i = 0; i < Size; i++)
            {
                int c = Mathf.RoundToInt(i * 0.7f + 8f);
                if (c >= 0 && c < Size) Cells[i, c].terrain = Terrain.River;
            }
        }

        public bool InBounds(int r, int c) => r >= 0 && r < Size && c >= 0 && c < Size;

        /// <summary>地图里是否存在河道格（灾难系统判断内涝用）。</summary>
        public bool HasRiver()
        {
            for (int r = 0; r < Size; r++)
            for (int c = 0; c < Size; c++)
                if (Cells[r, c].terrain == Terrain.River) return true;
            return false;
        }

        public Vector3 CellToWorld(int r, int c) =>
            new Vector3((c - Size * 0.5f + 0.5f) * CellSize, 0f, (r - Size * 0.5f + 0.5f) * CellSize);

        public bool WorldToCell(Vector3 world, out int r, out int c)
        {
            c = Mathf.RoundToInt(world.x / CellSize + Size * 0.5f - 0.5f);
            r = Mathf.RoundToInt(world.z / CellSize + Size * 0.5f - 0.5f);
            return InBounds(r, c);
        }

        public bool CanBuild(int r, int c) =>
            InBounds(r, c) && Cells[r, c].kind == TileKind.Empty && Cells[r, c].terrain != Terrain.River;

        public bool Place(int r, int c, TileKind kind)
        {
            if (!CanBuild(r, c)) return false;
            var cell = Cells[r, c];
            cell.kind = kind;
            cell.built = 0f;
            Cells[r, c] = cell;
            Changed?.Invoke();
            return true;
        }

        public void Demolish(int r, int c)
        {
            if (!InBounds(r, c)) return;
            var cell = Cells[r, c];
            cell.kind = TileKind.Empty;
            cell.built = 0f;
            cell.occupancy = 0f;
            cell.level = 0;
            Cells[r, c] = cell;
            Changed?.Invoke();
        }

        public IEnumerable<(int r, int c, Cell cell)> All()
        {
            for (int r = 0; r < Size; r++)
            for (int c = 0; c < Size; c++)
                yield return (r, c, Cells[r, c]);
        }
    }
}

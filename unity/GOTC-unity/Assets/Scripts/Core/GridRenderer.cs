using System.Collections.Generic;
using UnityEngine;
using Gotc.UI;

namespace Gotc.Core
{
    /// <summary>
    /// 把 48×48 的地图烘成一个 mesh：每个格子两个三角形，顶点色区分地形与用途。
    /// 2304 格合一后只有 4608 个三角形，一次 draw call 就画完。
    /// </summary>
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public sealed class GridRenderer : MonoBehaviour
    {
        public InfoView infoView = InfoView.Default;
        public CitySim sim;

        public GridMap map;
        Mesh _mesh;
        bool _dirty = true;

        static readonly Color Empty = new Color(0.72f, 0.83f, 0.55f);
        static readonly Color EmptyHill = new Color(0.62f, 0.74f, 0.47f);
        static readonly Color EmptyForest = new Color(0.45f, 0.63f, 0.38f);
        static readonly Color River = new Color(0.38f, 0.58f, 0.78f);
        static readonly Color Res = new Color(0.35f, 0.85f, 0.45f);
        static readonly Color Com = new Color(0.35f, 0.65f, 0.95f);
        static readonly Color Ind = new Color(0.95f, 0.78f, 0.32f);
        static readonly Color Green = new Color(0.24f, 0.72f, 0.45f);
        static readonly Color Civic = new Color(0.72f, 0.52f, 0.92f);
        static readonly Color Road = new Color(0.55f, 0.57f, 0.62f);

        void Awake()
        {
            _mesh = new Mesh { name = "Grid" };
            GetComponent<MeshFilter>().sharedMesh = _mesh;
            var renderer = GetComponent<MeshRenderer>();
            renderer.sharedMaterial = new Material(Shader.Find("Sprites/Default")) { name = "GridMat" };
        }

        public void MarkDirty() => _dirty = true;

        void Start()
        {
            // AddComponent 时 map 还没赋值，OnEnable 订阅不到，这里补一次。
            if (map == null) return;
            map.Changed -= MarkDirty;
            map.Changed += MarkDirty;
            _dirty = true;
        }

        void OnEnable()
        {
            if (map != null) map.Changed += MarkDirty;
        }

        void OnDisable()
        {
            if (map != null) map.Changed -= MarkDirty;
        }

        void LateUpdate()
        {
            if (!_dirty || map == null) return;
            _dirty = false;
            Rebuild();
        }

        void Rebuild()
        {
            var vertices = new List<Vector3>(GridMap.Size * GridMap.Size * 4);
            var colors = new List<Color>(vertices.Capacity);
            var triangles = new List<int>(GridMap.Size * GridMap.Size * 6);
            float half = GridMap.CellSize * 0.48f;   // 留 4% 缝隙，俯视时能看出格子边界

            for (int r = 0; r < GridMap.Size; r++)
            for (int c = 0; c < GridMap.Size; c++)
            {
                var cell = map.Cells[r, c];
                var center = map.CellToWorld(r, c);
                float y = cell.terrain == Terrain.Hill ? 0.35f : cell.terrain == Terrain.Forest ? 0.18f : 0f;

                int baseIndex = vertices.Count;
                vertices.Add(center + new Vector3(-half, y, -half));
                vertices.Add(center + new Vector3(-half, y, half));
                vertices.Add(center + new Vector3(half, y, half));
                vertices.Add(center + new Vector3(half, y, -half));

                var color = ColorOf(cell);
                for (int i = 0; i < 4; i++) colors.Add(color);

                triangles.Add(baseIndex); triangles.Add(baseIndex + 1); triangles.Add(baseIndex + 2);
                triangles.Add(baseIndex); triangles.Add(baseIndex + 2); triangles.Add(baseIndex + 3);
            }

            _mesh.Clear();
            _mesh.SetVertices(vertices);
            _mesh.SetColors(colors);
            _mesh.SetTriangles(triangles, 0);
            _mesh.RecalculateBounds();
        }

        Color ColorOf(Cell cell)
        {
            if (infoView != InfoView.Default && cell.kind != TileKind.Empty)
            {
                float v = 0.5f;
                if (sim != null)
                {
                    v = infoView switch
                    {
                        InfoView.LandPrice => Mathf.Clamp01(sim.landPrice / 100f),
                        InfoView.Pollution => Mathf.Clamp01(0.25f + cell.level * 0.15f),
                        InfoView.Traffic => Mathf.Clamp01(0.30f + cell.occupancy),
                        InfoView.Happiness => Mathf.Clamp01(1f - cell.occupancy * 0.8f),
                        InfoView.Employment => Mathf.Clamp01(cell.occupancy),
                        _ => 0.5f,
                    };
                }
                return InfoViewController.Heat(v) * 0.85f + Color.white * 0.15f;
            }
            switch (cell.kind)
            {
                case TileKind.Residential: return Res;
                case TileKind.Commercial: return Com;
                case TileKind.Industrial: return Ind;
                case TileKind.Green: return Green;
                case TileKind.Civic: return Civic;
                case TileKind.Road: return Road;
            }
            return cell.terrain switch
            {
                Terrain.River => River,
                Terrain.Hill => EmptyHill,
                Terrain.Forest => EmptyForest,
                _ => Empty
            };
        }
    }
}

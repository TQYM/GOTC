using System.Collections.Generic;
using UnityEngine;

namespace Gotc.Core
{
    /// <summary>
    /// 把已建成的格子画成立体块：一栋楼一个 cuboid，顶点色跟随 kind。
    ///
    /// 为什么合并成一个 mesh 而不是每格一个 GameObject：
    /// 48×48 = 2304 格，真实片区有 1321 栋，逐个建 GameObject 会拖垮 draw call。
    /// 这里把全部 cuboid 顶点塞进一个 Mesh，一次 draw 画完。
    ///
    /// 高度规则对齐 C:S 的观感：等级越高越矮胖→细高，
    /// 但 City20 是 2D 出身的像素风，所以用「层数 × 1.1 米」的粗略比例，
    /// 不做真实建筑轮廓。
    /// </summary>
    public sealed class BuildingRenderer : MonoBehaviour
    {
        public GridMap map;
        public CitySim sim;

        Mesh _mesh;
        MeshFilter _filter;
        readonly List<Vector3> _verts = new List<Vector3>(8192);
        readonly List<Color> _colors = new List<Color>(8192);
        readonly List<int> _tris = new List<int>(16384);

        static readonly Color[] KindColors =
        {
            new Color(0.62f, 0.80f, 0.55f), // Empty
            new Color(0.36f, 0.72f, 0.42f), // Residential 绿
            new Color(0.32f, 0.56f, 0.88f), // Commercial 蓝
            new Color(0.86f, 0.66f, 0.28f), // Industrial 黄
            new Color(0.42f, 0.78f, 0.44f), // Green
            new Color(0.72f, 0.58f, 0.86f), // Civic 紫
            new Color(0.40f, 0.42f, 0.46f), // Road 灰
        };

        void Start()
        {
            _filter = GetComponent<MeshFilter>();
            if (_filter == null) _filter = gameObject.AddComponent<MeshFilter>();
            var mr = GetComponent<MeshRenderer>();
            if (mr == null) mr = gameObject.AddComponent<MeshRenderer>();
            mr.material = new Material(Shader.Find("Sprites/Default"));
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            if (map != null) map.Changed += Rebuild;
            Rebuild();
        }

        void OnDestroy()
        {
            if (map != null) map.Changed -= Rebuild;
        }

        public void Rebuild()
        {
            if (map == null) return;
            _verts.Clear(); _colors.Clear(); _tris.Clear();

            float cell = GridMap.CellSize;
            float half = cell * 0.42f;

            for (int r = 0; r < GridMap.Size; r++)
            for (int c = 0; c < GridMap.Size; c++)
            {
                var cellData = map.Cells[r, c];
                if (cellData.kind == TileKind.Empty || cellData.built <= 0.02f) continue;
                if (cellData.kind == TileKind.Road) continue;

                float h = HeightOf(cellData);
                if (h <= 0.05f) continue;

                var center = map.CellToWorld(r, c);
                Color col = KindColors[(int)cellData.kind];
                // 楼越高越亮一点，形成层次
                col *= 0.82f + 0.18f * Mathf.Clamp01(h / 18f);
                AddBox(new Vector3(center.x, h * 0.5f, center.z), half, h, col);
            }

            if (_mesh == null)
            {
                _mesh = new Mesh { name = "Buildings" };
                _mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            }
            _mesh.Clear();
            _mesh.SetVertices(_verts);
            _mesh.SetColors(_colors);
            _mesh.SetTriangles(_tris, 0);
            _mesh.RecalculateNormals();
            _filter.sharedMesh = _mesh;
        }

        static float HeightOf(Cell cell)
        {
            float baseH = cell.kind switch
            {
                TileKind.Residential => cell.level == 0 ? 3.2f : cell.level == 1 ? 7.5f : 14f,
                TileKind.Commercial => cell.level == 0 ? 4.5f : 9f,
                TileKind.Industrial => 3.0f,
                TileKind.Civic => 5.5f,
                TileKind.Green => 0.35f,
                _ => 0f,
            };
            return baseH * Mathf.Clamp01(cell.built);
        }

        /// <summary>一个去掉底面的盒子：4 个侧面 + 顶面，共 20 个顶点。</summary>
        void AddBox(Vector3 center, float half, float height, Color color)
        {
            float y0 = 0f, y1 = height;
            float x0 = center.x - half, x1 = center.x + half;
            float z0 = center.z - half, z1 = center.z + half;

            Vector3 a = new(x0, y0, z0), b = new(x1, y0, z0);
            Vector3 c = new(x1, y0, z1), d = new(x0, y0, z1);
            Vector3 a1 = new(x0, y1, z0), b1 = new(x1, y1, z0);
            Vector3 c1 = new(x1, y1, z1), d1 = new(x0, y1, z1);

            int i = _verts.Count;
            // 四个侧面
            Quad(a, b, b1, a1, color);
            Quad(b, c, c1, b1, color);
            Quad(c, d, d1, c1, color);
            Quad(d, a, a1, d1, color);
            // 顶面
            Quad(a1, b1, c1, d1, color * 1.08f);
        }

        void Quad(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, Color color)
        {
            int i = _verts.Count;
            _verts.Add(p0); _verts.Add(p1); _verts.Add(p2); _verts.Add(p3);
            for (int k = 0; k < 4; k++) _colors.Add(color);
            _tris.Add(i); _tris.Add(i + 1); _tris.Add(i + 2);
            _tris.Add(i); _tris.Add(i + 2); _tris.Add(i + 3);
        }
    }
}

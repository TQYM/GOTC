using System.Collections.Generic;
using UnityEngine;

namespace Gotc.Core
{
    /// <summary>
    /// 市民点位：把抽样的代理画成小方点，沿「家 → 工作地」做往返移动。
    ///
    /// 渲染方式：每帧把所有代理的立方体顶点重建进一个 Mesh。
    /// 为什么不用 Graphics.DrawMeshInstanced：Sprites/Default 这个 shader 没有
    /// INSTANCING_ON 变体，DrawMeshInstanced 会静默不画（踩过一次，画面里一个人都没有）。
    /// 400 个立方体 = 8000 顶点，每帧重建的开销远小于一次 draw call 的收益。
    /// </summary>
    public sealed class CitizenAgents : MonoBehaviour
    {
        public GridMap map;
        public CitySim sim;

        public int maxAgents = 320;
        public float secondsPerCell = 0.55f;

        struct Proxy
        {
            public Vector3 a;
            public Vector3 b;
            public float phase;
            public float speed;
        }

        readonly List<Proxy> _proxies = new();
        readonly List<Vector3> _verts = new(8192);
        readonly List<Color> _colors = new(8192);
        readonly List<int> _tris = new(16384);

        Mesh _mesh;
        MeshFilter _filter;

        static readonly Color Dot = new(1f, 0.93f, 0.35f);

        void Start()
        {
            _filter = GetComponent<MeshFilter>() ?? gameObject.AddComponent<MeshFilter>();
            var mr = GetComponent<MeshRenderer>() ?? gameObject.AddComponent<MeshRenderer>();
            mr.material = new Material(Shader.Find("Sprites/Default"));
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;

            _mesh = new Mesh { name = "CitizenDots" };
            _mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            _filter.sharedMesh = _mesh;

            if (map != null) map.Changed += Rebuild;
            Rebuild();
        }

        void OnDestroy()
        {
            if (map != null) map.Changed -= Rebuild;
        }

        public void Rebuild()
        {
            _proxies.Clear();
            if (map == null) return;

            var homes = new List<Vector3>();
            var jobs = new List<Vector3>();
            var roads = new List<Vector3>();
            for (int r = 0; r < GridMap.Size; r++)
            for (int c = 0; c < GridMap.Size; c++)
            {
                var k = map.Cells[r, c].kind;
                if (k == TileKind.Residential) homes.Add(map.CellToWorld(r, c));
                else if (k == TileKind.Commercial || k == TileKind.Industrial) jobs.Add(map.CellToWorld(r, c));
                else if (k == TileKind.Road) roads.Add(map.CellToWorld(r, c));
            }

            if (homes.Count > 0 && jobs.Count > 0)
            {
                int n = Mathf.Min(maxAgents, homes.Count * 8);
                for (int i = 0; i < n; i++)
                {
                    _proxies.Add(new Proxy
                    {
                        a = homes[Hash(i, 7) % homes.Count],
                        b = jobs[Hash(i, 13) % jobs.Count],
                        phase = Hash01(i, 17),
                        speed = 0.7f + 0.6f * Hash01(i, 19),
                    });
                }
            }
            else if (roads.Count >= 2)
            {
                // 没有住宅或岗位：让点在道路上走，避免「死城」观感
                int n = Mathf.Min(maxAgents, roads.Count * 2);
                for (int i = 0; i < n; i++)
                {
                    int ia = Hash(i, 11) % roads.Count;
                    int ib = Hash(i, 23) % roads.Count;
                    if (ia == ib) ib = (ia + 3) % roads.Count;
                    _proxies.Add(new Proxy
                    {
                        a = roads[ia],
                        b = roads[ib],
                        phase = Hash01(i, 31),
                        speed = 0.6f + 0.8f * Hash01(i, 37),
                    });
                }
            }
        }

        void Update()
        {
            if (_mesh == null || _proxies.Count == 0) return;

            _verts.Clear(); _colors.Clear(); _tris.Clear();
            float t = Time.time;
            const float half = 0.42f;   // 点的大小（世界单位，约为半格）

            for (int i = 0; i < _proxies.Count; i++)
            {
                var p = _proxies[i];
                float cycle = Mathf.Repeat(t * p.speed / Mathf.Max(1f, secondsPerCell) + p.phase, 2f);
                float u = cycle <= 1f ? cycle : 2f - cycle;
                var pos = Vector3.Lerp(p.a, p.b, u);
                pos.y = 3.4f + Mathf.Sin(t * 3f + i) * 0.12f;
                AddCube(pos, half, Dot);
            }

            _mesh.Clear();
            _mesh.SetVertices(_verts);
            _mesh.SetColors(_colors);
            _mesh.SetTriangles(_tris, 0);
        }

        void AddCube(Vector3 p, float h, Color color)
        {
            Vector3 a = new(p.x - h, p.y - h, p.z - h);
            Vector3 b = new(p.x + h, p.y - h, p.z - h);
            Vector3 c = new(p.x + h, p.y - h, p.z + h);
            Vector3 d = new(p.x - h, p.y - h, p.z + h);
            Vector3 a1 = new(p.x - h, p.y + h, p.z - h);
            Vector3 b1 = new(p.x + h, p.y + h, p.z - h);
            Vector3 c1 = new(p.x + h, p.y + h, p.z + h);
            Vector3 d1 = new(p.x - h, p.y + h, p.z + h);

            Quad(a, b, b1, a1, color);
            Quad(b, c, c1, b1, color);
            Quad(c, d, d1, c1, color);
            Quad(d, a, a1, d1, color);
            Quad(a1, b1, c1, d1, color * 1.15f);
        }

        void Quad(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, Color color)
        {
            int i = _verts.Count;
            _verts.Add(p0); _verts.Add(p1); _verts.Add(p2); _verts.Add(p3);
            for (int k = 0; k < 4; k++) _colors.Add(color);
            _tris.Add(i); _tris.Add(i + 1); _tris.Add(i + 2);
            _tris.Add(i); _tris.Add(i + 2); _tris.Add(i + 3);
        }

        static int Hash(int i, int salt)
        {
            unchecked
            {
                uint h = 2166136261u;
                h = (h ^ (uint)i) * 16777619u;
                h = (h ^ (uint)salt) * 16777619u;
                return (int)(h & 0x7FFFFFFF);
            }
        }

        static float Hash01(int i, int salt) => (Hash(i, salt) % 1000) / 1000f;
    }
}

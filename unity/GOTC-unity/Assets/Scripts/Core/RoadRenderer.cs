using System.Collections.Generic;
using UnityEngine;

namespace Gotc.Core
{
    /// <summary>
    /// 道路图层：把 <c>TileKind.Road</c> 的格子画成深灰路面，并沿相邻道路补上连接段。
    ///
    /// 为什么单独一个渲染器：道路比地块低（贴在 y=0.02），而建筑要从 0 长起来，
    /// 两者混在一个 mesh 里会因为共面产生 z-fighting。
    /// </summary>
    public sealed class RoadRenderer : MonoBehaviour
    {
        public GridMap map;

        Mesh _mesh;
        MeshFilter _filter;
        readonly List<Vector3> _verts = new();
        readonly List<Color> _colors = new();
        readonly List<int> _tris = new();

        static readonly Color Asphalt = new(0.26f, 0.28f, 0.31f);
        static readonly Color Lane = new(0.72f, 0.74f, 0.62f);

        void Start()
        {
            _filter = GetComponent<MeshFilter>() ?? gameObject.AddComponent<MeshFilter>();
            var mr = GetComponent<MeshRenderer>() ?? gameObject.AddComponent<MeshRenderer>();
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
            float half = cell * 0.46f;

            for (int r = 0; r < GridMap.Size; r++)
            for (int c = 0; c < GridMap.Size; c++)
            {
                if (map.Cells[r, c].kind != TileKind.Road) continue;

                var p = map.CellToWorld(r, c);
                FlatQuad(p.x - half, p.x + half, p.z - half, p.z + half, Asphalt);

                // 沿相邻方向补一段中线（近似车道），让路网看起来是连通的
                bool up = IsRoad(r - 1, c), down = IsRoad(r + 1, c);
                bool left = IsRoad(r, c - 1), right = IsRoad(r, c + 1);
                const float w = 0.16f;
                if (up) FlatQuad(p.x - w, p.x + w, p.z - half, p.z, Lane);
                if (down) FlatQuad(p.x - w, p.x + w, p.z, p.z + half, Lane);
                if (left) FlatQuad(p.x - half, p.x, p.z - w, p.z + w, Lane);
                if (right) FlatQuad(p.x, p.x + half, p.z - w, p.z + w, Lane);
                // 孤立路段画个短横线，避免看起来什么都没画
                if (!up && !down && !left && !right)
                    FlatQuad(p.x - half * 0.6f, p.x + half * 0.6f, p.z - w, p.z + w, Lane);
            }

            if (_mesh == null)
            {
                _mesh = new Mesh { name = "Roads" };
                _mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            }
            _mesh.Clear();
            _mesh.SetVertices(_verts);
            _mesh.SetColors(_colors);
            _mesh.SetTriangles(_tris, 0);
            _filter.sharedMesh = _mesh;
        }

        bool IsRoad(int r, int c) =>
            map.InBounds(r, c) && map.Cells[r, c].kind == TileKind.Road;

        void FlatQuad(float x0, float x1, float z0, float z1, Color color)
        {
            int i = _verts.Count;
            const float y = 0.03f;
            _verts.Add(new Vector3(x0, y, z0));
            _verts.Add(new Vector3(x1, y, z0));
            _verts.Add(new Vector3(x1, y, z1));
            _verts.Add(new Vector3(x0, y, z1));
            for (int k = 0; k < 4; k++) _colors.Add(color);
            _tris.Add(i); _tris.Add(i + 1); _tris.Add(i + 2);
            _tris.Add(i); _tris.Add(i + 2); _tris.Add(i + 3);
        }
    }
}

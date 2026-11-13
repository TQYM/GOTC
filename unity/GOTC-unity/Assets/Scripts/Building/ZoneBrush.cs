using System.Collections.Generic;
using UnityEngine;
using Gotc.Core;

namespace Gotc.Building
{
    /// <summary>
    /// 拖拽刷子：对齐 C:S 的 zoning tool（按下拖出矩形、松开批量划区）。
    /// 与 BuildingPlacer 的单格放置共存：Shift 按住时切到刷子模式。
    /// </summary>
    public class ZoneBrush : MonoBehaviour
    {
        public GridMap map;
        public CitySim sim;
        public Camera cam;

        public TileKind kind = TileKind.Residential;
        public int maxSpan = 16;

        bool _dragging;
        Vector2Int _start;
        Vector2Int _end;
        readonly List<Vector2Int> _preview = new List<Vector2Int>(256);

        GameObject _ghostRoot;
        readonly List<GameObject> _ghosts = new List<GameObject>(256);

        void Update()
        {
            if (map == null || cam == null) return;

            if (Input.GetMouseButtonDown(0) && (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift)))
            {
                if (TryPick(out var cell))
                {
                    _dragging = true;
                    _start = cell;
                    _end = cell;
                    RebuildPreview();
                }
            }
            else if (_dragging && Input.GetMouseButton(0))
            {
                if (TryPick(out var cell) && cell != _end)
                {
                    _end = cell;
                    RebuildPreview();
                }
            }
            else if (_dragging && Input.GetMouseButtonUp(0))
            {
                Commit();
                _dragging = false;
                ClearPreview();
            }

            if (Input.GetKeyDown(KeyCode.Alpha1)) kind = TileKind.Residential;
            if (Input.GetKeyDown(KeyCode.Alpha2)) kind = TileKind.Commercial;
            if (Input.GetKeyDown(KeyCode.Alpha3)) kind = TileKind.Industrial;
            if (Input.GetKeyDown(KeyCode.Alpha4)) kind = TileKind.Green;
        }

        bool TryPick(out Vector2Int cell)
        {
            cell = default;
            var ray = cam.ScreenPointToRay(Input.mousePosition);
            if (!Physics.Raycast(ray, out var hit, 400f)) return false;
            if (!map.WorldToCell(hit.point, out int r, out int c)) return false;
            cell = new Vector2Int(r, c);
            return true;
        }

        void RebuildPreview()
        {
            ClearPreview();
            _preview.Clear();

            int x0 = Mathf.Min(_start.x, _end.x), x1 = Mathf.Max(_start.x, _end.x);
            int y0 = Mathf.Min(_start.y, _end.y), y1 = Mathf.Max(_start.y, _end.y);
            if (x1 - x0 + 1 > maxSpan) x1 = x0 + maxSpan - 1;
            if (y1 - y0 + 1 > maxSpan) y1 = y0 + maxSpan - 1;

            if (_ghostRoot == null)
            {
                _ghostRoot = new GameObject("ZonePreview");
                _ghostRoot.transform.SetParent(transform, false);
            }

            var mat = new Material(Shader.Find("Sprites/Default"));
            mat.color = new Color(0.35f, 0.95f, 0.55f, 0.35f);

            for (int x = x0; x <= x1; x++)
            {
                for (int y = y0; y <= y1; y++)
                {
                    var p = new Vector2Int(x, y);
                    _preview.Add(p);

                    var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
                    go.name = $"zp_{x}_{y}";
                    go.transform.SetParent(_ghostRoot.transform, false);
                    go.transform.position = map.CellToWorld(p.x, p.y) + Vector3.up * 0.08f;
                    go.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
                    go.transform.localScale = Vector3.one * (GridMap.CellSize * 0.94f);
                    var col = go.GetComponent<Collider>();
                    if (col != null) Destroy(col);
                    go.GetComponent<Renderer>().sharedMaterial = mat;
                    _ghosts.Add(go);
                }
            }
        }

        void ClearPreview()
        {
            for (int i = 0; i < _ghosts.Count; i++)
                if (_ghosts[i] != null) Destroy(_ghosts[i]);
            _ghosts.Clear();
        }

        void Commit()
        {
            int placed = 0, skipped = 0;
            for (int i = 0; i < _preview.Count; i++)
            {
                var p = _preview[i];
                if (!map.CanBuild(p.x, p.y)) { skipped++; continue; }
                map.Place(p.x, p.y, kind);
                placed++;
            }
            if (map != null) map.NotifyChanged();
            Debug.Log($"[ZoneBrush] {kind} 放置 {placed} 格，跳过 {skipped} 格");
        }
    }
}

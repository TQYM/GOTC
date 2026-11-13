using Gotc.Core;
using UnityEngine;

namespace Gotc.Building
{
    /// <summary>
    /// 建造工具：鼠标左键放置、右键拆除、Q/E 切换类型。
    /// C:S 的工具系统是「一个工具持续占用鼠标，直到切走」——这里用同样的模式，
    /// 而不是每点一次就退出建造。
    /// </summary>
    public sealed class BuildingPlacer : MonoBehaviour
    {
        public GridMap map;

        [SerializeField] TileKind current = TileKind.Residential;
        [SerializeField] float cellPickHeight = 0.2f;
        [SerializeField] LayerMask groundMask = ~0;

        Camera _cam;
        GameObject _ghost;
        Vector3 _ghostScale;

        static readonly TileKind[] Cycle =
        {
            TileKind.Residential, TileKind.Commercial, TileKind.Industrial,
            TileKind.Green, TileKind.Civic, TileKind.Road
        };

        public TileKind Current => current;

        void Awake()
        {
            _cam = Camera.main;
            _ghostScale = new Vector3(GridMap.CellSize * 0.85f, 0.15f, GridMap.CellSize * 0.85f);
            _ghost = GameObject.CreatePrimitive(PrimitiveType.Cube);
            _ghost.name = "Ghost";
            _ghost.transform.localScale = _ghostScale;
            var col = _ghost.GetComponent<Collider>();
            if (col != null) Destroy(col);
            var renderer = _ghost.GetComponent<Renderer>();
            var mat = new Material(Shader.Find("Sprites/Default"));
            mat.color = new Color(0.3f, 0.9f, 0.5f, 0.45f);
            renderer.material = mat;
        }

        void Update()
        {
            if (_cam == null) _cam = Camera.main;
            if (_cam == null || map == null) return;

            if (Input.GetKeyDown(KeyCode.Q)) CycleTool(-1);
            if (Input.GetKeyDown(KeyCode.E)) CycleTool(1);

            if (!TryPick(out int r, out int c))
            {
                _ghost.SetActive(false);
                return;
            }

            bool ok = map.CanBuild(r, c);
            _ghost.SetActive(true);
            _ghost.transform.position = map.CellToWorld(r, c) + Vector3.up * 0.08f;
            _ghost.GetComponent<Renderer>().material.color = ok
                ? new Color(0.3f, 0.9f, 0.5f, 0.45f)
                : new Color(0.95f, 0.35f, 0.35f, 0.45f);

            if (Input.GetMouseButtonDown(0) && ok) map.Place(r, c, current);
            if (Input.GetMouseButtonDown(1)) map.Demolish(r, c);
        }

        void CycleTool(int dir)
        {
            int index = System.Array.IndexOf(Cycle, current);
            if (index < 0) index = 0;
            current = Cycle[(index + dir + Cycle.Length) % Cycle.Length];
        }

        bool TryPick(out int r, out int c)
        {
            r = c = -1;
            var ray = _cam.ScreenPointToRay(Input.mousePosition);
            var plane = new Plane(Vector3.up, new Vector3(0f, cellPickHeight, 0f));
            if (!plane.Raycast(ray, out float enter)) return false;
            return map.WorldToCell(ray.GetPoint(enter), out r, out c);
        }
    }
}

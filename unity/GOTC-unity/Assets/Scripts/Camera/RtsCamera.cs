using UnityEngine;

namespace Gotc.CameraRig
{
    /// <summary>
    /// RTS 相机：WASD/中键平移、滚轮缩放、右键旋转。C:S 的操作手感。
    /// 平移速度随高度线性放大，缩到最近时速度减半，避免近景一按就飞出去。
    /// </summary>
    public sealed class RtsCamera : MonoBehaviour
    {
        [SerializeField] float panSpeed = 40f;
        [SerializeField] float minHeight = 8f;
        [SerializeField] float maxHeight = 180f;
        [SerializeField] float zoomStep = 10f;
        [SerializeField] float rotateSpeed = 120f;
        [SerializeField] Vector2 bounds = new Vector2(48f, 48f);

        Vector3 _pivot = Vector3.zero;
        float _height = 135f;
        float _yaw = 45f;
        float _pitch = 62f;

        void Start()
        {
            Debug.Log($"[Cam] start pivot={_pivot} height={_height} yaw={_yaw} pitch={_pitch} pos={transform.position}");
        }

        void Update()
        {
            var move = Vector3.zero;
            if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow)) move.z += 1f;
            if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow)) move.z -= 1f;
            if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow)) move.x -= 1f;
            if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) move.x += 1f;

            if (move.sqrMagnitude > 0f)
            {
                var rot = Quaternion.Euler(0f, _yaw, 0f);
                _pivot += rot * move.normalized * (panSpeed * (_height / maxHeight + 0.4f) * Time.deltaTime);
                _pivot.x = Mathf.Clamp(_pivot.x, -bounds.x, bounds.x);
                _pivot.z = Mathf.Clamp(_pivot.z, -bounds.y, bounds.y);
            }

            float scroll = Input.mouseScrollDelta.y;
            if (Mathf.Abs(scroll) > 0.01f)
                _height = Mathf.Clamp(_height - scroll * zoomStep, minHeight, maxHeight);

            if (Input.GetMouseButton(1))
            {
                _yaw += Input.GetAxis("Mouse X") * rotateSpeed * Time.deltaTime;
                _pitch = Mathf.Clamp(_pitch - Input.GetAxis("Mouse Y") * rotateSpeed * Time.deltaTime, 25f, 80f);
            }

            var rotQ = Quaternion.Euler(_pitch, _yaw, 0f);
            transform.position = _pivot - rotQ * Vector3.forward * _height;
            // 直接用 LookAt 对准 pivot，避免欧拉角顺序导致视线偏离地图中心。
            transform.LookAt(_pivot);
            if (Time.frameCount % 120 == 0)
                Debug.Log($"[Cam] frame={Time.frameCount} pivot={_pivot} height={_height} pos={transform.position} euler={transform.eulerAngles}");
        }
    }
}

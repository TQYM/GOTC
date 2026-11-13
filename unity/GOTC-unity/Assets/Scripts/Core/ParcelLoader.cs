using System;
using System.IO;
using UnityEngine;

namespace Gotc.Core
{
    [Serializable]
    public class ParcelBuildingDTO
    {
        public int r;
        public int c;
        public string kind;
        public int level;
    }

    [Serializable]
    public class ParcelRoadDTO
    {
        public int r;
        public int c;
    }

    /// <summary>
    /// 真实地块 —— 由 tools/export_parcel.py 从 data/parcels/&lt;id&gt;/ 转换而来，
    /// 放在 Assets/StreamingAssets/parcels/&lt;id&gt;.json。
    ///
    /// JsonUtility 不支持二维数组，所以地形拍平成一维 string[]，长度 size*size。
    /// </summary>
    [Serializable]
    public class ParcelData
    {
        public string parcelId;
        public string districtName;
        public int size;
        public int cellSizeM;
        public int seed;
        public string[] terrain;          // 拍平：r * size + c
        public ParcelBuildingDTO[] buildings;
        public ParcelRoadDTO[] roads;
    }

    public static class ParcelLoader
    {
        public static string PathFor(string parcelId) =>
            Path.Combine(Application.streamingAssetsPath, "parcels", $"{parcelId}.json");

        public static ParcelData Load(string parcelId)
        {
            string path = PathFor(parcelId);
            if (!File.Exists(path))
            {
                Debug.LogWarning($"[Parcel] 未找到 {path}");
                return null;
            }
            try
            {
                var data = JsonUtility.FromJson<ParcelData>(File.ReadAllText(path));
                if (data == null || data.size != GridMap.Size)
                {
                    Debug.LogError($"[Parcel] {parcelId} 尺寸不匹配（期望 {GridMap.Size}，实际 {data?.size}）");
                    return null;
                }
                return data;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Parcel] 解析失败 {parcelId}: {ex.Message}");
                return null;
            }
        }

        /// <summary>把地块数据灌进 GridMap；已有的道路/建筑会被覆盖。</summary>
        public static bool Apply(string parcelId, GridMap map)
        {
            var data = Load(parcelId);
            if (data == null) return false;

            map.seed = data.seed;

            // 1) 地形
            for (int r = 0; r < GridMap.Size; r++)
            for (int c = 0; c < GridMap.Size; c++)
            {
                var cell = map.Cells[r, c];
                string t = data.terrain[r * GridMap.Size + c];
                cell.terrain = t switch
                {
                    "River" => Terrain.River,
                    "Hill" => Terrain.Hill,
                    "Forest" => Terrain.Forest,
                    _ => Terrain.Flat,
                };
                cell.kind = TileKind.Empty;
                cell.level = 0;
                cell.built = 0f;
                cell.occupancy = 0f;
                map.Cells[r, c] = cell;
            }

            // 2) 继承道路
            if (data.roads != null)
            {
                foreach (var road in data.roads)
                {
                    if (!map.InBounds(road.r, road.c)) continue;
                    var cell = map.Cells[road.r, road.c];
                    if (cell.terrain == Terrain.River) continue;
                    cell.kind = TileKind.Road;
                    map.Cells[road.r, road.c] = cell;
                }
            }

            // 3) 既有建筑：直接视为已建成（C:S 的 map 已有建筑同理）
            if (data.buildings != null)
            {
                foreach (var b in data.buildings)
                {
                    if (!map.InBounds(b.r, b.c)) continue;
                    var cell = map.Cells[b.r, b.c];
                    if (cell.terrain == Terrain.River) continue;
                    cell.kind = b.kind switch
                    {
                        "Residential" => TileKind.Residential,
                        "Commercial" => TileKind.Commercial,
                        "Industrial" => TileKind.Industrial,
                        "Civic" => TileKind.Civic,
                        "Green" => TileKind.Green,
                        "Road" => TileKind.Road,
                        _ => TileKind.Residential,
                    };
                    cell.level = (byte)Mathf.Clamp(b.level, 0, 2);
                    cell.built = 1f;
                    cell.occupancy = cell.kind == TileKind.Residential ? 0.85f : 0.6f;
                    map.Cells[b.r, b.c] = cell;
                }
            }

            map.NotifyChanged();
            Debug.Log($"[Parcel] {data.districtName}: {data.size}×{data.size}, 建筑 {data.buildings?.Length ?? 0}, 道路 {data.roads?.Length ?? 0}");
            return true;
        }
    }
}

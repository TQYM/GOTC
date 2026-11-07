#!/usr/bin/env python3
"""全域北京 OSM 数据分批拉取（断点续拉 + 限速）。
产物：tools/prepare-beijing/raw/<name>.json（Overpass out geom / out center）。
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent / "raw"
RAW.mkdir(parents=True, exist_ok=True)

INSTANCES = [
    ("https://overpass.private.coffee/api/interpreter", None),
    ("https://overpass-api.de/api/interpreter", "CITY20-Hackathon/1.0"),
]

ALL = "39.40,115.60,41.10,117.50"       # 北京全域
CORE = "39.75,116.10,40.10,116.66"      # 东西朝海城四区


def grid(bbox, nx, ny):
    s, w, n, e = [float(x) for x in bbox.split(",")]
    for i in range(nx):
        for j in range(ny):
            yield f"{s+(n-s)*i/ny:.4f},{w+(e-w)*j/nx:.4f},{s+(n-s)*(i+1)/ny:.4f},{w+(e-w)*(j+1)/nx:.4f}"


# (名称, bbox, 查询体, 分块nx, ny)
TASKS = []
for i, bb in enumerate(grid(ALL, 2, 2)):
    TASKS.append((f"roads_major_{i}", bb,
                  'way["highway"~"^(motorway|trunk|primary)$"];out geom;', 0))
for i, bb in enumerate(grid(CORE, 2, 2)):
    TASKS.append((f"roads_minor_{i}", bb,
                  'way["highway"~"^(secondary|tertiary)$"];out geom;', 0))
TASKS.append(("water", ALL,
              '(way["waterway"];way["natural"="water"];);out geom;', 0))
TASKS.append(("parks", ALL,
              '(way["leisure"~"^(park|garden)$"];);out geom;', 0))
for i, bb in enumerate(grid(CORE, 2, 2)):
    TASKS.append((f"buildings_named_{i}", bb,
                  'way["building"]["name"];out geom;', 0))
TASKS.append(("landmarks", ALL,
              '(way["name"~"^(故宫|天安门|国家体育场|鸟巢|水立方|国家游泳中心|中国尊|中信大厦|中央电视台总部大楼|北京站|北京西站|北京南站|首都国际机场|大兴国际机场|颐和园|圆明园|天坛|北海公园|景山公园|香山公园|奥林匹克森林公园|中关村|金融街)"];relation["name"~"^(故宫|国家体育场|水立方|中央电视台总部大楼)"];);out geom;', 0))
TASKS.append(("labels_transit_edu", ALL,
              '(node["railway"="station"];way["railway"="station"];node["amenity"~"^(school|hospital|university)$"];way["amenity"~"^(school|hospital|university)$"];);out center;', 0))
TASKS.append(("labels_places", ALL,
              '(node["place"~"^(city|town|suburb|village)$"]["name"];node["tourism"="attraction"]["name"];way["tourism"="attraction"]["name"];node["natural"="peak"]["name"];);out center;', 0))


def fetch(name, bbox, body):
    out = RAW / f"{name}.json"
    if out.exists() and out.stat().st_size > 500:
        print(f"SKIP {name}（已存在）", flush=True)
        return
    q = f'[out:json][timeout:240][bbox:{bbox}];{body}'
    data = urllib.parse.urlencode({"data": q}).encode()
    for base, ua in INSTANCES:
        req = urllib.request.Request(base, data=data)
        if ua:
            req.add_header("User-Agent", ua)
        try:
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=300) as r:
                payload = json.loads(r.read().decode())
            n = len(payload.get("elements", []))
            out.write_text(json.dumps(payload))
            print(f"OK {name}: {n} 元素, {time.time()-t0:.0f}s, {out.stat().st_size//1024}KB", flush=True)
            return
        except Exception as e:
            print(f"ERR {name} @{base}: {e}", flush=True)
    print(f"FAIL {name}", flush=True)


for name, bbox, body, _ in TASKS:
    fetch(name, bbox, body)
    time.sleep(3)
print("ALL DONE", flush=True)

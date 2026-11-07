#!/usr/bin/env python3
"""补拉失败分片：roads_minor_0 剩余小块 + water 全域拆 2×2（断点续拉）。"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent / "raw"
INSTANCES = [("https://overpass.private.coffee/api/interpreter", None),
             ("https://overpass-api.de/api/interpreter", "CITY20-Hackathon/1.0")]


def fetch(name, bbox, body):
    out = RAW / f"{name}.json"
    if out.exists() and out.stat().st_size > 500:
        print(f"SKIP {name}", flush=True)
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
            out.write_text(json.dumps(payload))
            print(f"OK {name}: {len(payload.get('elements', []))} 元素, "
                  f"{time.time()-t0:.0f}s, {out.stat().st_size//1024}KB", flush=True)
            return
        except Exception as err:
            print(f"ERR {name} @{base}: {err}", flush=True)
    print(f"FAIL {name}", flush=True)


def grid(s, w, n, e, nx, ny):
    for i in range(ny):
        for j in range(nx):
            yield (f"{s+(n-s)*i/ny:.4f},{w+(e-w)*j/nx:.4f},"
                   f"{s+(n-s)*(i+1)/ny:.4f},{w+(e-w)*(j+1)/nx:.4f}")


# roads_minor_0 西南块（39.75–39.925, 116.10–116.38）拆 2×2，0_0 已补成功
for k, bb in enumerate(grid(39.75, 116.10, 39.925, 116.38, 2, 2)):
    fetch(f"roads_minor_0_{k}", bb, 'way["highway"~"^(secondary|tertiary)$"];out geom;')
    time.sleep(3)

# water 全域拆 2×2（原整域查询双实例超时）
for k, bb in enumerate(grid(39.40, 115.60, 41.10, 117.50, 2, 2)):
    fetch(f"water_{k}", bb, '(way["waterway"];way["natural"="water"];);out geom;')
    time.sleep(3)

# parks 若主补充流也失败则拆块兜底
if not (RAW / "parks.json").exists():
    for k, bb in enumerate(grid(39.40, 115.60, 41.10, 117.50, 2, 2)):
        fetch(f"parks_{k}", bb, '(way["leisure"~"^(park|garden)$"];);out geom;')
        time.sleep(3)

print("MISSING DONE", flush=True)

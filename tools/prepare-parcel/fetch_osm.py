#!/usr/bin/env python3
"""开发期一次性获取 OSM 原始数据；后端运行与 prepare_parcel 均不访问网络。"""

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
QUERY = """
[out:json][timeout:180];
(
  way["building"]({south},{west},{north},{east});
  relation["building"]({south},{west},{north},{east});
  way["highway"]({south},{west},{north},{east});
  way["natural"="water"]({south},{west},{north},{east});
  relation["natural"="water"]({south},{west},{north},{east});
  way["waterway"]({south},{west},{north},{east});
  relation["waterway"="riverbank"]({south},{west},{north},{east});
  way["landuse"]({south},{west},{north},{east});
  relation["landuse"]({south},{west},{north},{east});
  way["leisure"]({south},{west},{north},{east});
  relation["leisure"]({south},{west},{north},{east});
  way["railway"]({south},{west},{north},{east});
  node["railway"="station"]({south},{west},{north},{east});
);
out body geom;
""".strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parcel", default="beijing_cbd")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("parcels.yaml"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = yaml.safe_load(args.config.read_text("utf-8"))[args.parcel]
    west, south, east, north = config["bbox"]
    query = QUERY.format(west=west, south=south, east=east, north=north)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    errors = []
    for endpoint in ENDPOINTS:
        try:
            request = urllib.request.Request(
                endpoint,
                data=urllib.parse.urlencode({"data": query}).encode(),
                headers={
                    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                    "User-Agent": (
                        "CITY20-offline-parcel-preparation/1.0 (OSM attribution included)"
                    ),
                },
            )
            with urllib.request.urlopen(request, timeout=240) as response:
                payload = response.read()
            data = json.loads(payload)
            if not data.get("elements"):
                raise ValueError("Overpass 返回空 elements")
            args.output.write_bytes(payload)
            args.output.with_suffix(".request.txt").write_text(query + "\n", encoding="utf-8")
            args.output.with_suffix(".source.json").write_text(
                json.dumps(
                    {
                        "source": "© OpenStreetMap contributors",
                        "license": "ODbL-1.0",
                        "endpoint": endpoint,
                        "retrieved_at_epoch": int(time.time()),
                        "bbox": config["bbox"],
                        "elements": len(data["elements"]),
                        "sha256": hashlib.sha256(payload).hexdigest(),
                    },
                    ensure_ascii=False,
                    indent=2,
                ) + "\n",
                encoding="utf-8",
            )
            print(f"saved {len(data['elements'])} elements to {args.output}")
            return
        except (OSError, ValueError, urllib.error.URLError) as exc:
            errors.append(f"{endpoint}: {exc}")
    raise SystemExit("OSM 获取失败；不会生成合成替代数据：\n" + "\n".join(errors))


if __name__ == "__main__":
    main()

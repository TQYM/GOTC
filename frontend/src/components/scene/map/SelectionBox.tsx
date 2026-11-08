"use client";

/** 选中建筑的描边框（PR-36）：1 个 LineSegments，按建筑表外接矩形 + 地表高度生成 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BuildingTable } from "@saves/lib/cityModel";
import { mapToWorld, type Surface } from "../coords";

export default function SelectionBox({
  table,
  index,
  surface,
}: {
  table: BuildingTable;
  index: number;
  surface: Surface;
}) {
  const line = useMemo(() => {
    const [x0, y0, x1, y1] = table.bbox.subarray(index * 4, index * 4 + 4);
    const base =
      Math.min(
        surface.heightAt(x0, y0),
        surface.heightAt(x1, y0),
        surface.heightAt(x0, y1),
        surface.heightAt(x1, y1),
      ) - 0.5;
    const h = table.height[index] + 4;
    const pad = 12;
    const [wx0, wz0] = mapToWorld(surface.f, x0 - pad, y0 - pad);
    const [wx1, wz1] = mapToWorld(surface.f, x1 + pad, y1 + pad);
    const geo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(Math.abs(wx1 - wx0), h, Math.abs(wz1 - wz0)),
    );
    const mat = new THREE.LineBasicMaterial({
      color: "#ff5a36",
      depthTest: false,
    });
    const obj = new THREE.LineSegments(geo, mat);
    obj.position.set((wx0 + wx1) / 2, base + h / 2, (wz0 + wz1) / 2);
    obj.renderOrder = 30;
    obj.raycast = () => {};
    obj.name = "map-selection";
    return obj;
  }, [table, index, surface]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

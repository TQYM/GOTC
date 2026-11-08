"use client";

/**
 * 全域地图渲染层（PR-36）：地形 / 水系 / 道路 / 建筑四层，各 1 个 draw call。
 *
 * 支持 WEBGL_multi_draw 时用 BatchedMesh：worker 给出的每个「槽」（空间分块 × LOD 部件）是一个实例，
 * 视锥裁剪（perObjectFrustumCulled）+ 本组件按相机到槽包围盒的距离切换可见性（4 档建筑 LOD、3 级地形、3 档道路），
 * 仍只算 1 次 draw call。不支持时退化为每层 1 个合并 Mesh（固定取中档细节，draw call 不变）。
 * 卡通着色：MeshToonMaterial + 3 阶 gradientMap（toon.ts），建筑 / 道路用顶点色。
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BUILDING_PART,
  type ChunkedGeometry,
  type FullMapData,
} from "@/lib/map/types";
import { toonMaterial } from "../toon";

type SlotFilter = (part: number, band: [number, number]) => boolean;

function slotGeometry(
  g: ChunkedGeometry,
  k: number,
): THREE.BufferGeometry | null {
  const [v, vc, i, ic] = g.chunks.subarray(k * 4, k * 4 + 4);
  if (vc === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(g.position.subarray(v * 3, (v + vc) * 3), 3),
  );
  geo.setAttribute(
    "normal",
    new THREE.BufferAttribute(g.normal.subarray(v * 3, (v + vc) * 3), 3, true),
  );
  if (g.color)
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(g.color.subarray(v * 3, (v + vc) * 3), 3, true),
    );
  if (g.index)
    geo.setIndex(new THREE.BufferAttribute(g.index.subarray(i, i + ic), 1));
  return geo;
}

interface LodLayer {
  mesh: THREE.BatchedMesh | THREE.Mesh;
  geo: ChunkedGeometry;
  /** 每个实例对应的槽号；合并模式为空 */
  slots: Int32Array;
  /** 每个实例当前可见性（0/1），避免重复 setVisibleAt */
  visible: Uint8Array;
}

function batched(
  name: string,
  g: ChunkedGeometry,
  material: THREE.Material,
): LodLayer | null {
  const n = g.chunks.length / 4;
  const slots: number[] = [];
  let vMax = 0;
  let iMax = 0;
  for (let k = 0; k < n; k++) {
    if (g.chunks[k * 4 + 1] === 0) continue;
    slots.push(k);
    vMax += g.chunks[k * 4 + 1];
    iMax += g.chunks[k * 4 + 3];
  }
  if (!slots.length) return null;
  const bm = new THREE.BatchedMesh(
    slots.length,
    vMax,
    g.index ? iMax : undefined,
    material,
  );
  for (const k of slots) {
    const geo = slotGeometry(g, k)!;
    bm.addInstance(bm.addGeometry(geo));
    geo.dispose();
  }
  bm.perObjectFrustumCulled = true;
  bm.sortObjects = false; // 不透明：省掉每帧排序
  bm.name = name;
  const visible = new Uint8Array(slots.length).fill(1);
  return { mesh: bm, geo: g, slots: Int32Array.from(slots), visible };
}

function merged(
  name: string,
  g: ChunkedGeometry,
  material: THREE.Material,
  keep: SlotFilter,
): LodLayer | null {
  const n = g.chunks.length / 4;
  let vTotal = 0;
  let iTotal = 0;
  const use: number[] = [];
  for (let k = 0; k < n; k++) {
    if (!g.chunks[k * 4 + 1]) continue;
    if (!keep(g.parts[k], [g.bands[k * 2], g.bands[k * 2 + 1]])) continue;
    use.push(k);
    vTotal += g.chunks[k * 4 + 1];
    iTotal += g.chunks[k * 4 + 3];
  }
  if (!use.length) return null;
  const position = new Float32Array(vTotal * 3);
  const normal = new Int8Array(vTotal * 3);
  const color = g.color ? new Uint8Array(vTotal * 3) : null;
  const index = g.index ? new Uint32Array(iTotal) : null;
  let v = 0;
  let i = 0;
  for (const k of use) {
    const [sv, vc, si, ic] = g.chunks.subarray(k * 4, k * 4 + 4);
    position.set(g.position.subarray(sv * 3, (sv + vc) * 3), v * 3);
    normal.set(g.normal.subarray(sv * 3, (sv + vc) * 3), v * 3);
    if (color && g.color)
      color.set(g.color.subarray(sv * 3, (sv + vc) * 3), v * 3);
    if (index && g.index)
      for (let j = 0; j < ic; j++) index[i + j] = g.index[si + j] + v;
    v += vc;
    i += ic;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3, true));
  if (color)
    geo.setAttribute("color", new THREE.BufferAttribute(color, 3, true));
  if (index) geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  return { mesh, geo: g, slots: new Int32Array(0), visible: new Uint8Array(0) };
}

function terrainMaterial(data: FullMapData): THREE.MeshToonMaterial {
  const { rows, cols, cell_m } = data.grid;
  const tex = new THREE.DataTexture(
    data.terrainRGBA,
    cols,
    rows,
    THREE.RGBAFormat,
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const m = toonMaterial({ color: "#ffffff" });
  const size = new THREE.Vector2(cols * cell_m, rows * cell_m);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrainTex = { value: tex };
    shader.uniforms.uMapSize = { value: size };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec2 uMapSize;\nvarying vec2 vMapUv;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvMapUv = vec2((position.x + uMapSize.x * 0.5) / uMapSize.x, (uMapSize.y * 0.5 - position.z) / uMapSize.y);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform sampler2D uTerrainTex;\nvarying vec2 vMapUv;",
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb *= texture2D(uTerrainTex, vMapUv).rgb;",
      );
  };
  m.customProgramCacheKey = () => "city20-terrain";
  m.userData.dispose = () => tex.dispose();
  return m;
}

/** 合并模式（无 multi_draw）下每层固定保留的部件：中档细节，三角形数可控 */
const FALLBACK: Record<string, SlotFilter> = {
  terrain: (part) => part === 1,
  water: () => true,
  roads: (part) => part <= 1,
  buildings: (part) =>
    part === BUILDING_PART.base ||
    part === BUILDING_PART.mid ||
    part === BUILDING_PART.landmark ||
    part === BUILDING_PART.boardLandmark,
};

/** 构建四层对象（主线程只做类型化数组 → GPU 几何的装配，耗时记入 window.__mapTimings 供性能记录） */
function buildMapObjects(data: FullMapData, multiDraw: boolean) {
  const t0 = performance.now();
  const mats = {
    terrain: terrainMaterial(data),
    water: toonMaterial({ color: "#7cc6ef" }),
    roads: toonMaterial({
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    buildings: toonMaterial({ vertexColors: true }),
  };
  const layers = (["terrain", "water", "roads", "buildings"] as const)
    .map((key) => {
      const name = `map-${key}`;
      return multiDraw
        ? batched(name, data[key], mats[key])
        : merged(name, data[key], mats[key], FALLBACK[key]);
    })
    .filter((l): l is LodLayer => !!l);
  for (const l of layers) l.mesh.raycast = () => {}; // 全域层不参与 R3F 拾取（走按格拾取）
  const ms = Math.round(performance.now() - t0);
  (window as unknown as { __mapTimings?: object }).__mapTimings = {
    ...data.stats.timings,
    gpuBuild: ms,
  };
  return { layers, mats };
}

/** 相机到轴对齐包围盒的距离（盒内为 0） */
function boxDistance(b: Float32Array, o: number, p: THREE.Vector3) {
  const dx = Math.max(b[o] - p.x, 0, p.x - b[o + 3]);
  const dy = Math.max(b[o + 1] - p.y, 0, p.y - b[o + 4]);
  const dz = Math.max(b[o + 2] - p.z, 0, p.z - b[o + 5]);
  return Math.hypot(dx, dy, dz);
}

export interface LodStats {
  /** 各层可见实例数 */
  visible: Record<string, number>;
  /** 建筑各部件可见槽数（base/mid/fine/simple/landmark/boardLandmark） */
  buildingParts: number[];
}

/** LOD 控制器：普通类（不进 React 渲染流程），每 0.15s 至多重算一次，相机几乎不动时跳过 */
class LodController {
  private x = NaN;
  private y = NaN;
  private z = NaN;
  private t = -Infinity;
  private hide = false;
  constructor(private layers: LodLayer[]) {}

  update(p: THREE.Vector3, time: number, hideBoardLandmarks: boolean) {
    if (time - this.t < 0.15) return;
    const moved = Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z);
    if (
      !Number.isNaN(this.x) &&
      !(moved > Math.max(20, p.y * 0.01)) &&
      this.hide === hideBoardLandmarks
    )
      return;
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.t = time;
    this.hide = hideBoardLandmarks;
    const stats: LodStats = { visible: {}, buildingParts: [0, 0, 0, 0, 0, 0] };
    for (const { mesh, geo, slots, visible } of this.layers) {
      if (!(mesh instanceof THREE.BatchedMesh)) continue;
      const isBuildings = mesh.name === "map-buildings";
      let count = 0;
      for (let id = 0; id < slots.length; id++) {
        const k = slots[id];
        const d = boxDistance(geo.boxes, k * 6, p);
        let on = d >= geo.bands[k * 2] && d < geo.bands[k * 2 + 1];
        if (
          isBuildings &&
          hideBoardLandmarks &&
          geo.parts[k] === BUILDING_PART.boardLandmark
        )
          on = false;
        if (on) {
          count++;
          if (isBuildings) stats.buildingParts[geo.parts[k]]++;
        }
        if (visible[id] !== (on ? 1 : 0)) {
          visible[id] = on ? 1 : 0;
          mesh.setVisibleAt(id, on);
        }
      }
      stats.visible[mesh.name] = count;
    }
    (window as unknown as { __mapLod?: LodStats }).__mapLod = stats;
  }
}

export default function MapLayers({
  data,
  hideBoardLandmarks = false,
  onReady,
}: {
  data: FullMapData;
  /** 沙盘自带真实建筑（CBD 数据包）时隐藏沙盘矩形内的全域地标，避免重影 */
  hideBoardLandmarks?: boolean;
  onReady?: (info: { batched: boolean }) => void;
}) {
  const gl = useThree((s) => s.gl);
  const multiDraw = useMemo(
    () =>
      !!gl.extensions.get("WEBGL_multi_draw") &&
      !/[?&]nomultidraw=1/.test(window.location.search),
    [gl],
  );

  const objects = useMemo(
    () => buildMapObjects(data, multiDraw),
    [data, multiDraw],
  );
  const lod = useRef<LodController | null>(null);

  useEffect(() => {
    onReady?.({ batched: multiDraw });
    const { layers, mats } = objects;
    lod.current = new LodController(layers);
    return () => {
      lod.current = null;
      for (const l of layers) {
        if (l.mesh instanceof THREE.BatchedMesh) l.mesh.dispose();
        else l.mesh.geometry.dispose();
      }
      for (const m of Object.values(mats)) {
        (m.userData.dispose as (() => void) | undefined)?.();
        m.dispose();
      }
    };
  }, [objects, multiDraw, onReady]);

  // LOD：按相机到每个槽包围盒的距离开关实例可见性（合并模式无实例，跳过）
  useFrame(({ camera, clock }) =>
    lod.current?.update(camera.position, clock.elapsedTime, hideBoardLandmarks),
  );

  return (
    <group>
      {objects.layers.map((l) => (
        <primitive key={l.mesh.name} object={l.mesh} />
      ))}
    </group>
  );
}

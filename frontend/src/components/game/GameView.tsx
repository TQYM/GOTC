"use client";

import Link from "next/link";
/**
 * 游戏页（WorldBox 风格 HUD 重构，PR-37）：
 * 全屏 3D 沙盘为底，所有 UI 悬浮：
 *   左上世界徽章（城市名/年份/城市码）· 顶部中央资源胶囊 · 右上时间控制 ·
 *   左下圆形能力坞 · 底部建造抽屉 · 右侧城市/动态面板 · 左下事件条。
 * 玩法逻辑（放置/拆除/改造/快进/推演/报告/拖拽）全部沿用 store，与 05/13/14 规格一致。
 */
import dynamic from "next/dynamic";
import { isNativeApp } from "@/lib/native";
import { withBase } from "@/lib/api/base";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { GhostSpec, PresetKey } from "@/components/scene/CityScene3D";
import MapHud from "@/components/scene/map/MapHud";
import { useFullMap } from "@/lib/map/loader";
import type { Cell, TileType } from "@/lib/contract";
import type { CityApi } from "@/lib/api";
import { SCENE_COLORS } from "@/lib/palette";
import { checkPlacement } from "@/lib/validate";
import { occupiedSet, tileAt, useGame } from "@/store/game";
import { TILE_SPECS } from "@/lib/catalog";
import { rememberRecent } from "@saves/lib/recent";
import { ResourcePills } from "./MetricsPanel";
import PhaseBanner from "./PhaseBanner";
import DemandPanel from "./DemandPanel";
import SpeedControl from "./SpeedControl";
import { WeatherBadge } from "./WeatherBadge";
import { TileActions } from "./TileActions";




import { MilestoneBar } from "./MilestoneBar";
import { InfoViewBar } from "./InfoViewBar";
import ReportSummary from "./ReportSummary";
import RemoveConfirm from "./RemoveConfirm";
import Toasts from "./Toasts";
import { SideDock } from "./SideDock";
import { TutorialOverlay } from "./TutorialOverlay";
import TileSheet from "@/components/hud/TileSheet";
import { TileCardFace } from "./ToolBar";
import AbilityDock from "@/components/hud/AbilityDock";
import BuildDrawer from "@/components/hud/BuildDrawer";
import InspectorPanel from "@/components/hud/InspectorPanel";
import NewsTicker from "@/components/hud/NewsTicker";
import TopBar from "@/components/hud/TopBar";
import Bgm from "@/components/game/Bgm";
import { PixelIcon } from "@/components/ui/PixelSprite";

const ASSET_FALLBACK_NAME: Record<string, string> = {
  residential: "既有住宅",
  workplace: "既有办公",
  industrial: "既有工业",
  civic: "公共服务",
};

const CityScene3D = dynamic(() => import("@/components/scene/CityScene3D"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-fg-muted">加载 3D 场景…</div>
  ),
});

export default function GameView({
  api,
  id,
  debug = false,
}: {
  api: CityApi;
  id: string;
  debug?: boolean;
}) {
  const init = useGame((s) => s.init);
  const status = useGame((s) => s.status);
  const connect = useGame((s) => s.connect);
  const loadError = useGame((s) => s.loadError);
  const parcel = useGame((s) => s.parcel);
  const cityName = useGame((s) => s.cityName);
  const cityYear = useGame((s) => s.cityYear);
  const tiles = useGame((s) => s.tiles);
  const redevelopedAssetIds = useGame((s) => s.redevelopedAssetIds);
  const funds = useGame((s) => s.metrics?.funds ?? null);
  const population = useGame((s) => s.metrics?.population ?? 0);
  const jobs = useGame((s) => s.metrics?.jobs ?? 0);
  const congestion = useGame((s) => s.metrics?.congestion ?? 0);
  const happiness = useGame((s) => s.metrics?.happiness ?? 0);
  const ambience = useMemo(
    () => ({ population, jobs, congestion, happiness }),
    [population, jobs, congestion, happiness],
  );
  const phase = useGame((s) => s.phase);
  const tool = useGame((s) => s.tool);
  const busy = useGame((s) => s.busy);
  const confirmRemove = useGame((s) => s.confirmRemove);
  const placeAt = useGame((s) => s.placeAt);
  const bridgeOrientation = useGame((s) => s.bridgeOrientation);
  const setBridgeOrientation = useGame((s) => s.setBridgeOrientation);
  const requestRemoveAt = useGame((s) => s.requestRemoveAt);
  const exitTool = useGame((s) => s.exitTool);
  const selectAt = useGame((s) => s.selectAt);
  const cancelRemove = useGame((s) => s.cancelRemove);
  const setTool = useGame((s) => s.setTool);
  const startPlanning = useGame((s) => s.startPlanning);
  // 手机端：跳过规划简报，进入即开始建造（m03777）
  useEffect(() => {
    if (!isNativeApp() || phase !== "briefing") return;
    if (!parcel) return;
    void startPlanning();
  }, [phase, parcel, startPlanning]);

  const toast = useGame((s) => s.toast);

  const selected = useGame((s) => s.selected);
  const existingAssets = useGame((s) => s.existingAssets);

  /**
   * 选中建筑时钉在屋顶上的名称牌。
   * 特殊建筑（学校 / 医院一类的 civic、以及 150m 以上的地标）不钉：
   * 它们已有固定地名牌和专属详情，再叠一层只会互相遮挡。
   */
  const selectedLabel = useMemo(() => {
    if (!selected) return null;
    const [r, c] = selected;
    const tile = tileAt(tiles, selected);
    if (tile) return { r, c, name: TILE_SPECS[tile.type].name, height: 26 };
    const asset = existingAssets[`${r}:${c}`];
    if (!asset) return null;
    if (asset.category === "civic" || asset.height_m >= 150) return null;
    return {
      r,
      c,
      name: asset.name ?? ASSET_FALLBACK_NAME[asset.category] ?? "既有建筑",
      height: asset.height_m,
    };
  }, [selected, tiles, existingAssets]);


  const [hover, setHover] = useState<Cell | null>(null);
  const [dragType, setDragType] = useState<TileType | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"city" | "feed" | null>(null);
  const sceneBox = useRef<HTMLDivElement>(null);
  // PR-36：北京全域地图作为背景，可玩沙盘嵌在 CBD 片区（v1 沙盘规格 48×48 @50m）
  // 东西朝海棋盘本身已覆盖 48km 全域，不再叠加全域地图层（会与 400m 棋盘地形重叠）
  const withWorldMap = !parcel || parcel.parcel_id !== "beijing_core";
  const parcelLabelsUrl =
    !withWorldMap && parcel
      ? withBase(`/static/parcels/${parcel.parcel_id}/labels.json`)
      : null;

  // 左上角标题：选中建筑 > 视野所在的区 > 城市名
  const [districtAnchors, setDistrictAnchors] = useState<
    { name: string; x: number; y: number }[] | null
  >(null);
  const [regionName, setRegionName] = useState<string | null>(null);

  useEffect(() => {
    if (!parcelLabelsUrl) return;
    let alive = true;
    fetch(parcelLabelsUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { labels?: { name?: string; kind?: string; x: number; y: number }[] } | null) => {
        if (!alive) return;
        const anchors = (json?.labels ?? [])
          .filter((l) => l.kind === "city" && l.name && l.name.endsWith("区"))
          .map((l) => ({ name: l.name as string, x: l.x, y: l.y }));
        setDistrictAnchors(anchors);
      })
      .catch(() => alive && setDistrictAnchors([]));
    return () => {
      alive = false;
    };
  }, [parcelLabelsUrl]);

  const focus = useGame((s) => s.focus);
  const existingCellKeys = useMemo(
    () => new Set(Object.keys(existingAssets ?? {})),
    [existingAssets],
  );
  const onViewTarget = useCallback(
    (x: number, z: number) => {
      if (!districtAnchors?.length || !parcel) return;
      const half = (parcel.size * parcel.cell_size_m) / 2;
      // 世界坐标 → 数据包局部米制（x 东、y 北）
      const mx = x + half;
      const my = half - z;
      let best: string | null = null;
      let bestD = Infinity;
      for (const a of districtAnchors) {
        const d = (a.x - mx) ** 2 + (a.y - my) ** 2;
        if (d < bestD) {
          bestD = d;
          best = a.name;
        }
      }
      setRegionName((prev) => (prev === best ? prev : best));
    },
    [districtAnchors, parcel],
  );
  const { state: mapState, retry: retryMap } = useFullMap(
    parcel
      ? {
          size: parcel.size,
          cell_size_m: parcel.cell_size_m,
          origin: parcel.origin,
        }
      : { size: 48, cell_size_m: 50 },
    withWorldMap,
  );
  const [preset, setPreset] = useState<{
    key: PresetKey;
    token: number;
  } | null>(null);

  useEffect(() => {
    void init(api, id);
  }, [api, id, init]);

  // 推送订阅：加载完成后建立，路由切换/卸载时断开（PR-14）
  useEffect(() => {
    if (status !== "ready") return;
    return connect();
  }, [status, connect]);

  useEffect(() => {
    if (status !== "ready" || !parcel) return;
    rememberRecent({
      cityCode: id,
      name: cityName ?? parcel.district_name ?? "我的城市",
      parcelId: parcel.parcel_id ?? "sandbox",
      cityYear,
    });
  }, [status, parcel, cityName, cityYear, id]);

  // E2E 调试钩子：?debug=1 时暴露 store 供自动化测试读取
  useEffect(() => {
    if (!debug) return;
    (window as unknown as { __city20Store?: typeof useGame }).__city20Store =
      useGame;
  }, [debug]);

  // ESC 逐级退出：确认框 → 工具 → 选择模式（13 §4.1）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const state = useGame.getState();
      if (state.confirmRemove) cancelRemove();
      else if (state.selected) selectAt(null);
      else exitTool();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelRemove, exitTool, selectAt]);

  const occupied = useMemo(() => occupiedSet(tiles), [tiles]);
  const placeType = tool.kind === "place" ? tool.type : null;

  const check = useMemo(
    () =>
      parcel && placeType && hover
        ? checkPlacement(
            parcel,
            occupied,
            funds,
            placeType,
            hover,
            placeType === "util_bridge" ? bridgeOrientation : undefined,
          )
        : null,
    [parcel, placeType, hover, occupied, funds, bridgeOrientation],
  );

  const ghost = useMemo<GhostSpec | null>(
    () =>
      check && placeType && hover
        ? {
            type: placeType,
            anchor: hover,
            cells: check.cells,
            orientation: bridgeOrientation,
            valid: check.ok,
          }
        : null,
    [check, placeType, hover, bridgeOrientation],
  );

  const removeTarget = tool.kind === "remove" && hover ? tileAt(tiles, hover) : undefined;
  const overlay = useMemo(() => {
    const t = confirmRemove?.tile ?? removeTarget;
    return t ? { cells: t.cells, color: SCENE_COLORS.invalid } : null;
  }, [confirmRemove, removeTarget]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const type = (e.active.data.current as { type?: TileType } | undefined)?.type;
    if (!type) return;
    setDragType(type);
    setTool({ kind: "place", type });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragType(null);
    const act = e.activatorEvent as PointerEvent | null;
    const box = sceneBox.current?.getBoundingClientRect();
    if (!act || !box) return;
    const x = act.clientX + e.delta.x;
    const y = act.clientY + e.delta.y;
    const onBoard = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    if (onBoard && hover) void placeAt(hover);
  };

  const togglePanel = (tab: "city" | "feed") =>
    setPanelTab((cur) => (cur === tab ? null : tab));

  if (status === "error") {
    return (
      <div className="grid h-screen place-items-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold">{loadError}</p>
          <Link
            href="/"
            className="px-action px-action-primary mt-4"
          >
            回首页
          </Link>
        </div>
      </div>
    );
  }

  const cursor =
    tool.kind === "place"
      ? check?.ok
        ? "copy"
        : "not-allowed"
      : tool.kind === "remove" || tool.kind === "redevelop"
        ? "crosshair"
        : undefined;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragType(null)}
    >
      <main
        className="relative h-dvh w-full overflow-hidden bg-[var(--px-sky)]"
        data-testid="game-view"
        data-phase={phase}
      >
        <Bgm />
        {/* 3D 沙盘：全屏铺底 */}
        <div ref={sceneBox} className="absolute inset-0">
          {parcel ? (
            <CityScene3D
              parcel={parcel}
              tiles={tiles}
              focusRequest={focus}
              showBuildable={buildOpen || tool.kind === "place"}
              existingCells={existingCellKeys}
              redevelopedAssetIds={redevelopedAssetIds}
              buildingsUrl={parcel.buildings_url}
              networkUrl={parcel.network_url}
              ghost={ghost}
              overlay={overlay}
              cursor={busy ? "progress" : cursor}
              onCellHover={setHover}
              onCellClick={(cell) => {
                // 建造模式直接落下；拆除模式点玩家建筑弹确认；
                // 其余模式（选择 / 改造）一律打开二级详情卡，由卡内按钮决定动作
                if (tool.kind === "place") void placeAt(cell);
                else if (tool.kind === "remove") requestRemoveAt(cell);
                else {
                  setPanelTab(null);
                  selectAt(cell);
                }
              }}
              onEmptyClick={() => selectAt(null)}
              ambience={ambience}
              selectedLabel={selectedLabel}
              onViewTarget={onViewTarget}
              onOutsideCore={() => {
                setPanelTab(null);
                selectAt(null);
                toast({
                  title: "超出管理范围",
                  hint: "你只负责东西朝海（东城、西城、朝阳、海淀）的更新。",
                  tone: "info",
                });
              }}
              onRightClick={exitTool}
              map={withWorldMap && mapState.status === "ready" ? mapState.data : null}
              parcelLabelsUrl={parcelLabelsUrl}
              initialPreset="cbd"
              labelTopInset={64}
              mapPickEnabled={tool.kind === "select"}
              presetRequest={preset}
              debugHook={debug}
            />
          ) : (
            <div className="grid h-full place-items-center text-fg-muted">加载城市…</div>
          )}
        </div>

        {/* HUD 层：不拦截场景操作，只有具体控件接收事件 */}
        <div className="pointer-events-none absolute inset-0 z-10">

          <div className="absolute left-4 top-4">
            <TopBar title={selectedLabel?.name ?? regionName ?? null} />
          </div>
          <div className="absolute left-1/2 top-4 hidden -translate-x-1/2 lg:block">
            <ResourcePills />
          </div>
          <div className="absolute left-1/2 top-[4.75rem] hidden -translate-x-1/2 lg:block">
            <SpeedControl />
        <div className="absolute bottom-24 right-4">
          <TileActions />
        </div>
        <div className="absolute left-1/2 top-[12.5rem] -translate-x-1/2">
          <WeatherBadge />
        </div>
          </div>

          <PhaseBanner />

          {/* PR-36：全域地图数据状态 / 视角预设控制（右上，避开 InspectorPanel） */}
          <div className="pointer-events-none absolute bottom-28 right-3 z-10 sm:bottom-auto sm:top-36">
            {withWorldMap && (
            <MapHud
              state={mapState}
              retry={retryMap}
              onPreset={(key) =>
                setPreset((p) => ({ key, token: (p?.token ?? 0) + 1 }))
              }
            />
            )}
          </div>

          <div className="absolute bottom-3 left-3">
            <AbilityDock
              buildOpen={buildOpen}
              onOpenBuild={() => setBuildOpen((v) => !v)}
              onOpenPanel={togglePanel}
              panelTab={panelTab}
            />
          </div>

          <div className="absolute bottom-[10.5rem] left-4">
            <NewsTicker onOpenFeed={() => setPanelTab("feed")} />
          </div>

          <div className="absolute bottom-[13.5rem] left-20">
            <DemandPanel />
          </div>

          <SideDock />

          <div className="absolute bottom-[13.5rem] right-4">
            <InfoViewBar />
          </div>

        <MilestoneBar />

          {panelTab && (
            <div className="absolute bottom-4 right-4 top-[8.5rem] z-20 w-[min(23rem,88vw)]">
              <InspectorPanel
                tab={panelTab}
                onTab={setPanelTab}
                onClose={() => setPanelTab(null)}
              />
            </div>
          )}

          <BuildDrawer open={buildOpen} onClose={() => setBuildOpen(false)} />

          {placeType === "util_bridge" && (
            <div
              className="px-panel pointer-events-auto absolute bottom-5 right-5 z-20 flex gap-2 p-2 text-xs"
              role="group"
              aria-label="桥梁方向"
            >
              {(["horizontal", "vertical"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`bridge-${value}`}
                  aria-pressed={bridgeOrientation === value}
                  onClick={() => setBridgeOrientation(value)}
                  className="px-tab min-h-9"
                >
                  {value === "horizontal" ? "东西向" : "南北向"}
                </button>
              ))}
            </div>
          )}

          {tool.kind === "place" && check && !check.ok && (
            <div
              className="pointer-events-none absolute left-1/2 top-[8.5rem] z-20 -translate-x-1/2 bg-[var(--px-bad)] px-4 py-2 text-[15px] text-white px-tip"
              data-testid="invalid-reason"
            >
              {check.reason}
            </div>
          )}
          {tool.kind === "place" && check?.ok && check.warning && (
            <div className="pointer-events-none absolute left-1/2 top-[8.5rem] z-20 -translate-x-1/2 bg-[var(--px-warn)] px-4 py-2 text-[15px] text-[var(--px-ink)] px-tip">
              {check.warning}
            </div>
          )}

          <ReportSummary />
          <Toasts />
      <TutorialOverlay />
          <TileSheet />

          {phase === "briefing" && parcel && (
            <div className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-[rgba(42,35,64,0.35)] p-4">
              <div className="px-panel px-anim-rise max-w-md p-5" data-testid="briefing">
                <h2 className="flex items-center gap-2.5 text-[22px] font-normal">
                  <PixelIcon name="report" scale={2} />
                  规划简报
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--px-ink-soft)]">
                  {parcel.constraints.briefing.text}
                </p>
                <button
                  type="button"
                  data-testid="start-planning"
                  disabled={busy}
                  onClick={() => void startPlanning()}
                  className="px-action px-action-primary mt-5 min-h-12 px-7 text-[17px]"
                >
                  开始规划
                </button>
              </div>
            </div>
          )}
        </div>

        <RemoveConfirm />
      </main>

      <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
        {dragType ? (
          <div className="px-panel px-3 py-2">
            <TileCardFace type={dragType} compact />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

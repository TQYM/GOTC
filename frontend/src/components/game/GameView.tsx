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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { GhostSpec } from "@/components/scene/CityScene3D";
import type { Cell, TileType } from "@/lib/contract";
import type { CityApi } from "@/lib/api";
import { SCENE_COLORS } from "@/lib/palette";
import { checkPlacement } from "@/lib/validate";
import { occupiedSet, tileAt, useGame } from "@/store/game";
import { rememberRecent } from "@saves/lib/recent";
import { ResourcePills } from "./MetricsPanel";
import PhaseBanner from "./PhaseBanner";
import ReportSummary from "./ReportSummary";
import RemoveConfirm from "./RemoveConfirm";
import Toasts from "./Toasts";
import { TileCardFace } from "./ToolBar";
import AbilityDock from "@/components/hud/AbilityDock";
import BuildDrawer from "@/components/hud/BuildDrawer";
import InspectorPanel from "@/components/hud/InspectorPanel";
import NewsTicker from "@/components/hud/NewsTicker";
import TopBar from "@/components/hud/TopBar";

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
  const phase = useGame((s) => s.phase);
  const tool = useGame((s) => s.tool);
  const busy = useGame((s) => s.busy);
  const confirmRemove = useGame((s) => s.confirmRemove);
  const placeAt = useGame((s) => s.placeAt);
  const redevelopAt = useGame((s) => s.redevelopAt);
  const bridgeOrientation = useGame((s) => s.bridgeOrientation);
  const setBridgeOrientation = useGame((s) => s.setBridgeOrientation);
  const requestRemoveAt = useGame((s) => s.requestRemoveAt);
  const exitTool = useGame((s) => s.exitTool);
  const cancelRemove = useGame((s) => s.cancelRemove);
  const setTool = useGame((s) => s.setTool);
  const startPlanning = useGame((s) => s.startPlanning);

  const [hover, setHover] = useState<Cell | null>(null);
  const [dragType, setDragType] = useState<TileType | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"city" | "feed" | null>(null);
  const sceneBox = useRef<HTMLDivElement>(null);

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
      if (useGame.getState().confirmRemove) cancelRemove();
      else exitTool();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelRemove, exitTool]);

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
            className="mt-3 inline-block rounded-full bg-[var(--wb-gold)] px-5 py-2 font-bold text-[#1c1610]"
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
        className="relative h-dvh w-full overflow-hidden bg-[#cfe6f2]"
        data-testid="game-view"
        data-phase={phase}
      >
        {/* 3D 沙盘：全屏铺底 */}
        <div ref={sceneBox} className="absolute inset-0">
          {parcel ? (
            <CityScene3D
              parcel={parcel}
              tiles={tiles}
              redevelopedAssetIds={redevelopedAssetIds}
              buildingsUrl={parcel.buildings_url}
              networkUrl={parcel.network_url}
              ghost={ghost}
              overlay={overlay}
              cursor={busy ? "progress" : cursor}
              onCellHover={setHover}
              onCellClick={(cell) => {
                if (tool.kind === "place") void placeAt(cell);
                else if (tool.kind === "remove") requestRemoveAt(cell);
                else if (tool.kind === "redevelop") void redevelopAt(cell);
              }}
              onRightClick={exitTool}
              debugHook={debug}
            />
          ) : (
            <div className="grid h-full place-items-center text-fg-muted">加载城市…</div>
          )}
        </div>

        {/* HUD 层：不拦截场景操作，只有具体控件接收事件 */}
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/25 to-transparent" />

          <div className="absolute left-3 top-3">
            <TopBar />
          </div>
          <div className="absolute left-1/2 top-3 hidden -translate-x-1/2 sm:block">
            <ResourcePills />
          </div>

          <PhaseBanner />

          <div className="absolute bottom-3 left-3">
            <AbilityDock
              buildOpen={buildOpen}
              onOpenBuild={() => setBuildOpen((v) => !v)}
              onOpenPanel={togglePanel}
              panelTab={panelTab}
            />
          </div>

          <div className="absolute bottom-28 left-3">
            <NewsTicker onOpenFeed={() => setPanelTab("feed")} />
          </div>

          {panelTab && (
            <div className="absolute bottom-3 right-3 top-[6.5rem] z-20 w-[min(22rem,88vw)]">
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
              className="pointer-events-auto absolute bottom-3 right-3 z-20 flex rounded-full border border-[var(--wb-gold-line)] bg-[var(--wb-panel-strong)] p-1 text-xs"
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
                  className="min-h-9 rounded-full px-3 aria-pressed:bg-[var(--wb-gold)] aria-pressed:font-bold aria-pressed:text-[#1c1610]"
                >
                  {value === "horizontal" ? "东西向" : "南北向"}
                </button>
              ))}
            </div>
          )}

          {tool.kind === "place" && check && !check.ok && (
            <div
              className="pointer-events-none absolute left-1/2 top-20 z-20 -translate-x-1/2 rounded-full bg-red-600/95 px-4 py-1.5 text-sm font-semibold text-white shadow-lg"
              data-testid="invalid-reason"
            >
              {check.reason}
            </div>
          )}
          {tool.kind === "place" && check?.ok && check.warning && (
            <div className="pointer-events-none absolute left-1/2 top-20 z-20 -translate-x-1/2 rounded-full bg-amber-400/95 px-4 py-1.5 text-sm font-semibold text-black shadow-lg">
              {check.warning}
            </div>
          )}

          <ReportSummary />
          <Toasts />

          {phase === "briefing" && parcel && (
            <div className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-black/35 p-4">
              <div className="wb-panel wb-anim-rise max-w-md rounded-2xl p-5" data-testid="briefing">
                <h2 className="text-lg font-bold">规划简报</h2>
                <p className="mt-2 text-sm text-[var(--wb-ink-muted)]">
                  {parcel.constraints.briefing.text}
                </p>
                <button
                  type="button"
                  data-testid="start-planning"
                  disabled={busy}
                  onClick={() => void startPlanning()}
                  className="mt-4 min-h-12 rounded-full bg-[var(--wb-gold)] px-6 font-bold text-[#1c1610] disabled:opacity-60 active:scale-[0.98]"
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
          <div className="rounded-xl border border-[var(--wb-gold)] bg-[var(--wb-panel-strong)] px-3 py-2 shadow-xl">
            <TileCardFace type={dragType} compact />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

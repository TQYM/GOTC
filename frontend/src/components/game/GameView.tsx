"use client";

import Link from "next/link";
/**
 * 游戏页主体（05 §2.2）：左指标 · 中 3D 沙盘（底部工具栏）· 右信息流（PR-14）。
 * 放置交互（05 §3.1 / 13 §4.3）：选中卡牌进入放置模式 → 幽灵预览（合法绿 / 非法红）→ 左键落子，
 * 保持放置模式可连续放置；右键单击 / ESC 逐级退出。卡牌也可直接拖到沙盘上落子。
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
import MetricsPanel from "./MetricsPanel";
import RemoveConfirm from "./RemoveConfirm";
import Toasts from "./Toasts";
import ToolBar, { TileCardFace } from "./ToolBar";

const CityScene3D = dynamic(() => import("@/components/scene/CityScene3D"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-fg-muted">
      加载 3D 场景…
    </div>
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
  const loadError = useGame((s) => s.loadError);
  const parcel = useGame((s) => s.parcel);
  const tiles = useGame((s) => s.tiles);
  const funds = useGame((s) => s.metrics?.funds ?? null);
  const phase = useGame((s) => s.phase);
  const tool = useGame((s) => s.tool);
  const busy = useGame((s) => s.busy);
  const confirmRemove = useGame((s) => s.confirmRemove);
  const placeAt = useGame((s) => s.placeAt);
  const requestRemoveAt = useGame((s) => s.requestRemoveAt);
  const exitTool = useGame((s) => s.exitTool);
  const cancelRemove = useGame((s) => s.cancelRemove);
  const setTool = useGame((s) => s.setTool);
  const startPlanning = useGame((s) => s.startPlanning);

  const [hover, setHover] = useState<Cell | null>(null);
  const [dragType, setDragType] = useState<TileType | null>(null);
  const sceneBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void init(api, id);
  }, [api, id, init]);

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
        ? checkPlacement(parcel, occupied, funds, placeType, hover)
        : null,
    [parcel, placeType, hover, occupied, funds],
  );

  const ghost = useMemo<GhostSpec | null>(
    () =>
      check && placeType && hover
        ? {
            type: placeType,
            anchor: hover,
            cells: check.cells,
            orientation: "horizontal",
            valid: check.ok,
          }
        : null,
    [check, placeType, hover],
  );

  const removeTarget =
    tool.kind === "remove" && hover ? tileAt(tiles, hover) : undefined;
  const overlay = useMemo(() => {
    const t = confirmRemove?.tile ?? removeTarget;
    return t ? { cells: t.cells, color: SCENE_COLORS.invalid } : null;
  }, [confirmRemove, removeTarget]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const type = (e.active.data.current as { type?: TileType } | undefined)
      ?.type;
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
    const onBoard =
      x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    if (onBoard && hover) void placeAt(hover);
  };

  if (status === "error") {
    return (
      <div className="grid h-screen place-items-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold">{loadError}</p>
          <Link
            href="/"
            className="mt-3 inline-block rounded-md bg-accent px-4 py-2 font-medium text-bg"
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
      : tool.kind === "remove"
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
        className="relative flex h-screen flex-col gap-2 p-2 lg:flex-row"
        data-testid="game-view"
        data-phase={phase}
      >
        <aside className="order-2 w-full shrink-0 overflow-y-auto lg:order-1 lg:w-56">
          <MetricsPanel />
        </aside>

        <section className="relative order-1 flex min-h-[70vh] flex-1 flex-col overflow-hidden rounded-lg border border-line lg:order-2 lg:min-h-0">
          <div ref={sceneBox} className="relative min-h-0 flex-1">
            {parcel ? (
              <CityScene3D
                parcel={parcel}
                tiles={tiles}
                ghost={ghost}
                overlay={overlay}
                cursor={busy ? "progress" : cursor}
                onCellHover={setHover}
                onCellClick={(cell) => {
                  if (tool.kind === "place") void placeAt(cell);
                  else if (tool.kind === "remove") requestRemoveAt(cell);
                }}
                onRightClick={exitTool}
                debugHook={debug}
              />
            ) : (
              <div className="grid h-full place-items-center text-fg-muted">
                加载城市…
              </div>
            )}

            {tool.kind === "place" && check && !check.ok && (
              <div
                className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-red-600/90 px-3 py-1 text-sm text-white"
                data-testid="invalid-reason"
              >
                {check.reason}
              </div>
            )}
            {tool.kind === "place" && check?.ok && check.warning && (
              <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-amber-500/90 px-3 py-1 text-sm text-black">
                {check.warning}
              </div>
            )}
            {tool.kind !== "select" && (
              <div className="pointer-events-none absolute right-3 top-3 rounded bg-black/50 px-2 py-1 text-xs text-white">
                {tool.kind === "remove" ? "拆除模式" : "放置模式"} · 右键 / ESC
                退出
              </div>
            )}

            {phase === "briefing" && parcel && (
              <div className="absolute inset-0 z-20 grid place-items-center bg-black/30 p-4">
                <div
                  className="max-w-md rounded-xl border border-line bg-bg-elev p-5 shadow-2xl"
                  data-testid="briefing"
                >
                  <h2 className="text-lg font-semibold">规划简报</h2>
                  <p className="mt-2 text-sm text-fg-muted">
                    {parcel.constraints.briefing.text}
                  </p>
                  <button
                    type="button"
                    data-testid="start-planning"
                    disabled={busy}
                    onClick={() => void startPlanning()}
                    className="mt-4 min-h-12 rounded-md bg-accent px-5 font-semibold text-bg disabled:opacity-60"
                  >
                    开始规划
                  </button>
                </div>
              </div>
            )}

            <Toasts />
          </div>
          <div className="border-t border-line bg-bg/80">
            <ToolBar />
          </div>
          <RemoveConfirm />
        </section>
      </main>
      <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
        {dragType ? (
          <div className="rounded-lg border border-accent bg-bg-elev/90 px-3 py-2 shadow-xl">
            <TileCardFace type={dragType} compact />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

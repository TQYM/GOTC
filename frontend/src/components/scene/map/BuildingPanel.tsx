"use client";

/**
 * 全域建筑面板（PR-36）：点击地图上的建筑后弹出。学校 / 医院额外给出服务半径内的住宅与同类设施数。
 * 建筑详情接口 GET /api/saves/{id}/buildings/{tileId} 尚未实现，这里只用前端已加载的数据包做本地版本，
 * 数值仅作参考，不进入任何指标计算。
 */
import {
  buildingInfo,
  serviceKind as serviceKindOf,
  serviceSummary,
  type BuildingInfo,
  type BuildingTable,
} from "@saves/lib/cityModel";

const CATEGORY_LABEL: Record<string, string> = {
  res_low: "低层住宅",
  res_mid: "多层住宅",
  res_high: "高层住宅",
  shop: "商业",
  cbd: "商务办公",
  light_industry: "产业园",
  school: "学校",
  hospital: "医院",
  landmark: "地标",
  residential: "住宅",
  workplace: "办公",
  industrial: "工业",
  civic: "公共建筑",
  other: "建筑",
};

const KIND_LABEL: Record<BuildingInfo["kind"], string> = {
  existing: "既有建筑",
  generated: "现状肌理（生成）",
  functional: "真实功能建筑",
  landmark: "城市地标",
};

export default function BuildingPanel({
  table,
  index,
  cell,
  onClose,
}: {
  table: BuildingTable;
  index: number;
  cell: [number, number];
  onClose: () => void;
}) {
  const info = buildingInfo(table, index);
  const service = info ? serviceSummary(table, index) : null;
  return (
    <div
      className="pointer-events-auto w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-bg-elev/95 p-3 text-sm shadow-xl"
      data-testid="building-panel"
      data-kind={info?.kind ?? "empty"}
      role="dialog"
      aria-label="建筑信息"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold" data-testid="building-name">
            {info?.name ?? (info ? CATEGORY_LABEL[info.category] : "空地")}
          </p>
          <p className="text-xs text-fg-muted">
            {info
              ? `${KIND_LABEL[info.kind]} · ${info.kind === "functional" && !serviceKindOf(info) ? `按${CATEGORY_LABEL[info.category] ?? "建筑"}计` : (CATEGORY_LABEL[info.category] ?? "建筑")}`
              : "该格没有建筑"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-9 min-w-9 rounded-md border border-line text-xs hover:border-accent"
          aria-label="关闭建筑信息"
          data-testid="building-panel-close"
        >
          ✕
        </button>
      </div>
      {info && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-fg-muted">高度</dt>
          <dd className="tabular-nums">{Math.round(info.height)} m</dd>
          <dt className="text-fg-muted">占地</dt>
          <dd className="tabular-nums">
            {info.footprintM2.toLocaleString("zh-CN")} m²
          </dd>
          <dt className="text-fg-muted">网格</dt>
          <dd className="tabular-nums">
            第 {cell[0]} 行 · 第 {cell[1]} 列
          </dd>
        </dl>
      )}
      {service && (
        <div
          className="mt-2 rounded-lg bg-bg/60 p-2 text-xs"
          data-testid="service-summary"
        >
          <p className="font-semibold">
            {service.kind === "school" ? "就学服务" : "就医服务"} · 半径{" "}
            {service.radius / 1000} km
          </p>
          <p className="mt-1">
            覆盖住宅 <b className="tabular-nums">{service.homes}</b> 栋 ·
            同类设施 <b className="tabular-nums">{service.peers}</b> 处
          </p>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-snug text-fg-muted">
        本地数据包信息（建筑详情接口未开放），仅供参考，不计入城市指标。
      </p>
    </div>
  );
}

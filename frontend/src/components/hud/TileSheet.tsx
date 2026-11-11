"use client";

/**
 * 二级界面：地块详情卡（PR-38，对标 Cities: Skylines 信息面板 / Anno 建筑卡）。
 *
 * 单击地图任意格 → 右侧滑出：
 *  - 空地：就地建造选择器（分类 + 卡牌，点一下即建，不用先选工具）
 *  - 我的建筑：容量/造价/维护/建成年 + 拆除
 *  - 既有建筑（真实数据）：名称/类别/高度/占地/现状人口岗位/拆迁费 + 拆除
 *  - 河流/道路/山地：只能看不能建
 *
 * 关闭：✕ / ESC / 再次点击空白格。
 */
import { useState } from "react";
import type { Terrain, TileType } from "@/lib/contract";
import { TILE_ORDER, TILE_SPECS, type TileCategory } from "@/lib/catalog";
import { yuan } from "@/lib/api/humanize";
import { tileAt, useGame } from "@/store/game";
import { CATEGORY_COLORS } from "@/lib/palette";
import { PixelIcon, TileThumb } from "@/components/ui/PixelSprite";
import type { IconName } from "@/lib/pixelArt";

const CATS: { key: TileCategory | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "residential", label: "住宅" },
  { key: "commercial", label: "商业" },
  { key: "industrial", label: "工业" },
  { key: "green", label: "绿地" },
  { key: "service", label: "服务" },
  { key: "transport", label: "交通" },
  { key: "utility", label: "市政" },
];

/** 既有建筑借用最接近的区块缩略图作头像 */
const ASSET_THUMB: Record<string, TileType> = {
  residential: "res_mid",
  workplace: "com_cbd",
  industrial: "ind_light",
  civic: "med_clinic",
};

const ASSET_CATEGORY: Record<string, string> = {
  residential: "住宅",
  workplace: "办公 / 商业",
  industrial: "工业",
  civic: "公共服务",
};

const TERRAIN_INFO: Partial<Record<Terrain, { title: string; hint: string; icon: IconName | null }>> = {
  river: { title: "河道", hint: "水面不可建造；需要跨河请用「跨河桥」。", icon: "wave" },
  road_inherited: { title: "既有道路", hint: "道路已占用，不能在上面放置区块。", icon: null },
  hill: { title: "丘陵", hint: "坡地暂不可建造，可先做平整或绕开。", icon: "hill" },
};

function ThumbFrame({ type, tint }: { type: TileType; tint: string }) {
  return (
    <span
      className="grid h-[72px] w-16 shrink-0 place-items-center"
      style={{ background: tint, boxShadow: "0 0 0 3px var(--px-ink), inset 0 -5px 0 rgba(42,35,64,0.12)" }}
      aria-hidden
    >
      <TileThumb type={type} scale={2} />
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="flex items-center gap-2 text-[12px] text-[var(--px-ink-soft)]">
        <span className="inline-block h-2 w-2 bg-[var(--px-ink)]" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-well flex items-baseline justify-between gap-3 px-2.5 py-1.5 text-sm">
      <span className="shrink-0 text-[var(--px-ink-soft)]">{label}</span>
      <span className="text-right text-[15px] tabular-nums text-[var(--px-ink)]">{value}</span>
    </div>
  );
}

export default function TileSheet() {
  const selected = useGame((s) => s.selected);
  const parcel = useGame((s) => s.parcel);
  const tiles = useGame((s) => s.tiles);
  const funds = useGame((s) => s.metrics?.funds ?? null);
  const phase = useGame((s) => s.phase);
  const busy = useGame((s) => s.busy);
  const existingAssets = useGame((s) => s.existingAssets);
  const buildAt = useGame((s) => s.buildAt);
  const zoneAt = useGame((s) => s.zoneAt);
  const selectAt = useGame((s) => s.selectAt);
  const requestRemoveAt = useGame((s) => s.requestRemoveAt);
  const demolishExisting = useGame((s) => s.demolishExisting);

  const [cat, setCat] = useState<TileCategory | "all">("all");
  /** 刷子边长：1 表示单点建造，>1 走批量划区（C:S 的拖拽刷子） */
  const [brush, setBrush] = useState(1);
  const [confirmDemolish, setConfirmDemolish] = useState(false);

  if (!selected || !parcel) return null;
  const [row, col] = selected;
  const terrain = parcel.terrain[row]?.[col];
  const tile = tileAt(tiles, selected);
  const asset = existingAssets[`${row}:${col}`];

  const close = () => {
    setConfirmDemolish(false);
    selectAt(null);
  };

  const list = TILE_ORDER.filter((t) => cat === "all" || TILE_SPECS[t].category === cat);
  const buildable = phase === "building";

  return (
    <aside
      className="px-panel px-anim-slide-right pointer-events-auto absolute bottom-4 right-4 top-[8.5rem] z-30 flex w-[min(23rem,88vw)] flex-col overflow-hidden"
      data-testid="tile-sheet"
      aria-label="地块详情"
    >
      <span
        className="block h-1.5 shrink-0"
        style={{ background: tile ? CATEGORY_COLORS[TILE_SPECS[tile.type].category] : "var(--px-paper-4)" }}
        aria-hidden
      />
      <header className="flex items-start gap-2 border-b-[3px] border-[var(--px-ink)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-[var(--px-ink-soft)]">
            地块 · 第 {row + 1} 行 第 {col + 1} 列
          </p>
          <h2 className="mt-1 truncate text-[22px] font-normal leading-tight text-[var(--px-ink)]">
            {tile
              ? TILE_SPECS[tile.type].name
              : asset
                ? asset.name ?? ASSET_CATEGORY[asset.category] ?? "既有建筑"
                : TERRAIN_INFO[terrain ?? "flat"]?.title ?? "空地"}
          </h2>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="关闭详情"
          className="px-icon-btn"
        >
          <PixelIcon name="close" scale={1} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tile ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <ThumbFrame type={tile.type} tint="var(--px-paper-2)" />
              <div className="grid gap-1.5 text-sm">
                <span className="px-chip self-start bg-[var(--px-sun)]">我的建筑</span>
                <p className="text-[16px] text-[var(--px-ink)]">{TILE_SPECS[tile.type].name}</p>
                <p className="text-[var(--px-ink-soft)]">{TILE_SPECS[tile.type].blurb}</p>
              </div>
            </div>

            <Section title="房屋信息">
              <InfoRow label="占地" value={`${tile.cells.length} 格`} />
              <InfoRow label="建造价" value={yuan(TILE_SPECS[tile.type].cost)} />
              <InfoRow label="年维护" value={yuan(tile.upkeep)} />
              <InfoRow label="建成于" value={`第 ${tile.built_at_year} 年`} />
              {tile.orientation && (
                <InfoRow
                  label="朝向"
                  value={tile.orientation === "horizontal" ? "东西向" : "南北向"}
                />
              )}
            </Section>

            <Section title="操作">
              <button
                type="button"
                data-testid="sheet-remove"
                disabled={busy || !buildable}
                onClick={() => requestRemoveAt(selected)}
                className="px-action px-action-danger w-full"
              >
                拆除（返还 30%）
              </button>
            </Section>
          </div>
        ) : asset ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <ThumbFrame type={ASSET_THUMB[asset.category] ?? "res_mid"} tint="var(--px-tint-blue)" />
              <div className="grid gap-1 text-sm">
                <span className="px-chip self-start bg-[var(--px-paper-2)]">真实建筑</span>
                <p className="text-[16px] text-[var(--px-ink)]">
                  {asset.name ?? ASSET_CATEGORY[asset.category]}
                </p>
                <p className="text-[var(--px-ink-soft)]">
                  真实北京既有建筑 · {asset.height_m.toFixed(0)} m
                  {asset.levels ? ` · 约 ${Math.round(asset.levels)} 层` : ""}
                </p>
              </div>
            </div>

            <Section title="现状">
              <InfoRow label="类别" value={ASSET_CATEGORY[asset.category] ?? asset.category} />
              <InfoRow label="占地" value={`${asset.cells.length} 格`} />
              {asset.population > 0 && <InfoRow label="居住人口" value={`${asset.population} 人`} />}
              {asset.jobs > 0 && <InfoRow label="就业岗位" value={`${asset.jobs} 个`} />}
              <InfoRow label="年维护" value={yuan(asset.upkeep)} />
            </Section>

            <Section title="更新改造">
              <p className="text-xs leading-relaxed text-[var(--px-ink-soft)]">
                拆除后土地转为空地，可重新规划。会扣除现状人口与岗位，并让周边居民不满（幸福度 −5）。
              </p>
              {confirmDemolish ? (
                <div className="grid gap-2">
                  <p className="px-chip self-start bg-[var(--px-warn)] text-xs">
                    确认拆除？需支付拆迁费 {yuan(asset.demolition_cost)}
                  </p>
                  <div className="flex gap-4 pt-1">
                    <button
                      type="button"
                      data-testid="sheet-demolish-confirm"
                      disabled={busy || !buildable}
                      onClick={() => void demolishExisting(selected)}
                      className="px-action px-action-danger flex-1"
                    >
                      确认拆除
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDemolish(false)}
                      className="px-action"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="sheet-demolish"
                  disabled={busy || !buildable || (funds !== null && funds < asset.demolition_cost)}
                  onClick={() => setConfirmDemolish(true)}
                  className="px-action px-action-danger w-full"
                >
                  拆除 · 需 {yuan(asset.demolition_cost)}
                </button>
              )}
            </Section>
          </div>
        ) : terrain && TERRAIN_INFO[terrain] ? (
          <div className="grid place-items-center gap-2 py-10 text-center">
            {TERRAIN_INFO[terrain]?.icon ? (
              <PixelIcon name={TERRAIN_INFO[terrain]!.icon!} scale={4} />
            ) : (
              <TileThumb type="trans_road" scale={3} />
            )}
            <p className="text-[18px] text-[var(--px-ink)]">{TERRAIN_INFO[terrain]?.title}</p>
            <p className="max-w-[16rem] text-xs leading-relaxed text-[var(--px-ink-soft)]">
              {TERRAIN_INFO[terrain]?.hint}
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-xs leading-relaxed text-[var(--px-ink-soft)]">
              {buildable
                ? "这块地可以建。选一种区块，点一下即建，可以连续建造。"
                : "当前阶段只能查看，回到「自由建设」后才能建造。"}
            </p>

            <div className="flex flex-wrap gap-2.5" role="group" aria-label="建造分类">
              {CATS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={cat === c.key}
                  onClick={() => setCat(c.key)}
                  className="px-tab"
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2" role="group" aria-label="刷子大小">
              <span className="text-xs text-[var(--px-ink-soft)]">刷子</span>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={brush === n}
                  data-testid={`brush-${n}`}
                  onClick={() => setBrush(n)}
                  className="px-tab tabular-nums"
                >
                  {n}×{n}
                </button>
              ))}
              {brush > 1 ? (
                <span className="text-[11px] text-[var(--px-ink-soft)]">
                  点一下铺满 {brush}×{brush}
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 p-0.5">
              {list.map((type) => {
                const spec = TILE_SPECS[type];
                const affordable = funds === null || spec.cost <= funds;
                const blocked = !buildable || busy || !affordable;
                return (
                  <button
                    key={type}
                    type="button"
                    data-testid={`sheet-build-${type}`}
                    disabled={blocked}
                    onClick={() =>
                      void (brush > 1
                        ? zoneAt(type, [row, col], brush, brush)
                        : buildAt(type, selected))
                    }
                    className="px-card flex items-center gap-2.5 px-2 py-1.5 text-left"
                  >
                    <TileThumb type={type} scale={1} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[15px] text-[var(--px-ink)]">
                        {spec.name}
                        <i
                          className="px-dot"
                          style={{ background: CATEGORY_COLORS[spec.category] }}
                        />
                      </span>
                      <span className="block truncate text-[11px] text-[var(--px-ink-soft)]">
                        {spec.blurb} · {yuan(spec.cost)}
                        {spec.footprint[0] * spec.footprint[1] > 1
                          ? ` · ${spec.footprint[0]}×${spec.footprint[1]}`
                          : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="pb-2 text-[11px] text-[var(--px-ink-soft)]">
              也可以从底部「建造」抽屉里挑卡牌，拖到沙盘上。
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

import Link from "next/link";
import CreateCity from "./CreateCity";
import { NativeEntry } from "@/components/native/NativeEntry";
import { PixelIcon, TileThumb } from "@/components/ui/PixelSprite";
import type { TileType } from "@/lib/contract";
import type { IconName } from "@/lib/pixelArt";

const FEATURES: [IconName, string][] = [
  ["build", "自由建设，不限时——分区、道路、公共配套"],
  ["ff", "随时快进一年，看城市运转"],
  ["crystal", "随时推演未来 10 年、生成城市诊断报告"],
  ["save", "输入城市码，换设备接着经营"],
];

/** 底部像素小镇：一排区块缩略图当天际线 */
const TOWN: TileType[] = [
  "green_park", "res_low", "res_mid", "com_shop", "res_high", "green_plaza", "com_cbd", "edu_school",
  "res_low", "trans_metro", "med_clinic", "res_mid", "green_park", "ind_light", "res_high", "com_shop",
];

/** 像素云：用三块矩形拼 */
function Cloud({ className }: { className: string }) {
  return (
    <div className={`pointer-events-none absolute ${className}`} aria-hidden>
      <div className="relative h-8 w-40">
        <span className="absolute left-3 top-3 h-4 w-34 bg-white" />
        <span className="absolute left-8 top-0 h-4 w-14 bg-white" />
        <span className="absolute left-20 top-1.5 h-3 w-10 bg-white" />
        <span className="absolute left-5 top-7 h-1 w-28 bg-[#E3F5FF]" />
      </div>
    </div>
  );
}

/** 落地页（05 §2.1 / 10 §7 / 16 §4.4 像素风）：创建新城；输入城市码加入 */
export default function Home() {
  return (
    <main className="relative flex w-full flex-1 flex-col overflow-hidden bg-[var(--px-sky)]">
      <NativeEntry />
      <Cloud className="left-[6%] top-[8%]" />
      <Cloud className="right-[10%] top-[14%] scale-75" />
      <Cloud className="left-[42%] top-[4%] scale-50" />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 items-center px-6 py-10">
        <div className="grid w-full gap-10 md:grid-cols-[1.05fr_1fr] md:items-center">
          <section>
            <p className="inline-flex items-center gap-2 bg-[var(--px-ink)] px-2.5 py-1.5 text-[13px] tracking-[0.2em] text-[var(--px-sun)]">
              CITY20 · 城市更新沙盘
            </p>
            <h1 className="mt-5 text-[44px] leading-[1.15] text-[var(--px-ink)] [text-shadow:4px_4px_0_var(--px-paper)] md:text-[56px]">
              在真实北京，
              <br />
              做一位城市管理者。
            </h1>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-[var(--px-ink-soft)]">
              朝阳 CBD–通惠河 2.4×2.4km 真实街区，48×48 格。拆旧建新、分区配套、快进十年，
              看你的决策怎样改变一座城。
            </p>
            <ul className="mt-6 grid gap-3 text-[15px] text-[var(--px-ink)]">
              {FEATURES.map(([icon, text]) => (
                <li key={text} className="flex items-center gap-3">
                  <span
                    className="grid h-9 w-9 place-items-center bg-[var(--px-paper)]"
                    style={{ boxShadow: "0 0 0 3px var(--px-ink)" }}
                    aria-hidden
                  >
                    <PixelIcon name={icon} scale={2} className="scale-75" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
            <Link
              href="/sandbox"
              className="mt-7 inline-block text-[13px] text-[var(--px-blue)] underline decoration-2 underline-offset-4"
            >
              3D 沙盘渲染预览（mock 地块）
            </Link>
          </section>

          <section className="px-panel px-anim-rise p-0">
            <div className="flex items-center gap-2.5 border-b-[3px] border-[var(--px-ink)] bg-[var(--px-sun)] px-4 py-2.5">
              <PixelIcon name="save" scale={2} />
              <h2 className="text-[20px] font-normal text-[var(--px-ink)]">开一座城</h2>
            </div>
            <div className="p-5 pt-3">
              <p className="text-[13px] text-[var(--px-ink-soft)]">
                默认使用真实北京 CBD 片区；也可以用确定性沙盒练手。
              </p>
              <CreateCity />
            </div>
          </section>
        </div>
      </div>

      <div className="relative z-0 flex items-end justify-center gap-0 overflow-hidden" aria-hidden>
        {TOWN.map((t, i) => (
          <TileThumb key={`${t}-${i}`} type={t} scale={3} className="-mx-1" />
        ))}
      </div>
    </main>
  );
}

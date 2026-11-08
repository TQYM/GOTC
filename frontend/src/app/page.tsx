import Link from "next/link";
import CreateCity from "./CreateCity";

/** 落地页（05 §2.1 / 10 §7 / PR-37 WorldBox 风格）：创建新城；输入城市码加入 */
export default function Home() {
  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-1 items-center px-6 py-10">
      <div className="grid w-full gap-8 md:grid-cols-[1.05fr_1fr] md:items-center">
        <section>
          <p className="text-xs font-semibold tracking-[0.3em] text-[var(--wb-gold)]">
            CITY20 · 城市更新沙盘
          </p>
          <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight text-[var(--wb-ink)] md:text-5xl">
            在真实北京，
            <br />
            做一位城市管理者。
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[var(--wb-ink-muted)]">
            朝阳 CBD–通惠河 2.4×2.4km 真实街区，48×48 格。拆旧建新、分区配套、快进十年，
            看你的决策怎样改变一座城。
          </p>
          <ul className="mt-6 grid gap-2 text-sm text-[var(--wb-ink-muted)]">
            {[
              ["🏗️", "自由建设，不限时——分区、道路、公共配套"],
              ["⏭️", "随时快进一年，看城市运转"],
              ["🔮", "随时推演未来 10 年、生成城市诊断报告"],
              ["🔑", "输入城市码，换设备接着经营"],
            ].map(([icon, text]) => (
              <li key={text} className="flex items-center gap-2">
                <span aria-hidden>{icon}</span>
                {text}
              </li>
            ))}
          </ul>
          <Link
            href="/sandbox"
            className="mt-6 inline-block text-xs text-[var(--wb-ink-muted)] underline decoration-[var(--wb-gold-line)] underline-offset-4"
          >
            3D 沙盘渲染预览（mock 地块）
          </Link>
        </section>

        <section className="wb-panel wb-anim-rise rounded-2xl p-5">
          <h2 className="text-base font-bold text-[var(--wb-ink)]">开一座城</h2>
          <p className="mt-1 text-xs text-[var(--wb-ink-muted)]">
            默认使用真实北京 CBD 片区；也可以用确定性沙盒练手。
          </p>
          <CreateCity />
        </section>
      </div>
    </main>
  );
}

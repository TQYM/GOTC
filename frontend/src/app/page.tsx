import Link from "next/link";

/** 落地页占位（05 §2.1 / 10 §7：创建新城 / 输入城市码加入，随 PR-25 接入存档接口） */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">
        CITY20 · 城市更新沙盘
      </h1>
      <p className="text-lg text-fg-muted">
        以城市管理者身份，在真实北京片区做更新决策，AI 规划师全程陪跑。
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-fg-muted">
        <li>自由建设，不限时：分区、道路、公共配套</li>
        <li>随时快进一年，看城市运转</li>
        <li>随时推演未来 10 年、生成城市诊断报告</li>
        <li>输入城市码，换设备接着经营</li>
      </ol>
      <div>
        <Link
          href="/sandbox"
          className="inline-block rounded-md bg-accent px-4 py-2 font-medium text-bg hover:opacity-90"
        >
          查看 3D 沙盘预览（mock 地块）
        </Link>
      </div>
    </main>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { pickApi, ApiError } from "@/lib/api";
import { humanizeError } from "@/lib/api/humanize";

export default function CreateCity() {
  const router = useRouter();
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async (mock: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const api = pickApi(new URLSearchParams(mock ? "mock=1" : ""));
      const n = seed.trim() ? Number(seed.trim()) : undefined;
      const { id } = await api.create(Number.isFinite(n) ? n : undefined);
      router.push(
        `/game?session=${encodeURIComponent(id)}${mock ? "&mock=1" : ""}`,
      );
    } catch (e) {
      setErr(e instanceof ApiError ? humanizeError(e).title : "创建失败");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="create-city"
          disabled={busy}
          onClick={() => void go(false)}
          className="min-h-12 rounded-md bg-accent px-5 font-semibold text-bg hover:opacity-90 disabled:opacity-60"
        >
          创建新城
        </button>
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="种子（可选，复现同款地块）"
          inputMode="numeric"
          className="min-h-12 w-56 rounded-md border border-line bg-bg-elev px-3"
          aria-label="种子"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void go(true)}
          className="min-h-12 rounded-md border border-line px-4 text-sm hover:bg-line disabled:opacity-60"
        >
          离线演示（不连后端）
        </button>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
    </div>
  );
}

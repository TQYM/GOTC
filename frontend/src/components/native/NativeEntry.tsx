"use client";

/**
 * 手机端专属入口（m03777）：打开 App 直接进游戏，跳过「创建城市」表单与规划简报确认。
 * - 有上次的城市码且后端认得 → 直接进
 * - 否则自动用 beijing_core 建一座城、立刻开始规划、进入 /game
 * Web 端渲染 null，落地页保持原样。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError } from "@/lib/api";
import { savesV2 } from "@/lib/api/savesV2";
import { isNativeApp, LAST_SESSION_KEY } from "@/lib/native";
import { PixelIcon } from "@/components/ui/PixelSprite";

export function NativeEntry() {
  const router = useRouter();
  const [native, setNative] = useState(false);
  const [note, setNote] = useState("正在进入东西朝海…");

  useEffect(() => {
    if (!isNativeApp()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 只在挂载时探测一次运行时环境
    setNative(true);
    let cancelled = false;

    const enter = async () => {
      const api = savesV2;
      const go = (id: string) => {
        localStorage.setItem(LAST_SESSION_KEY, id);
        router.replace(`/game?session=${encodeURIComponent(id)}`);
      };

      const saved = localStorage.getItem(LAST_SESSION_KEY);
      if (saved) {
        try {
          await api.load(saved);
          if (!cancelled) go(saved);
          return;
        } catch {
          localStorage.removeItem(LAST_SESSION_KEY);
        }
      }

      try {
        const { id } = await api.create({ name: "东西朝海", parcelId: "beijing_core" });
        // 简报不弹：直接替玩家点「开始规划」
        await api.startPlanning(id).catch(() => undefined);
        if (!cancelled) go(id);
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof ApiError ? error.message : "未知错误";
        setNote(`连不上后端（${detail}）。请确认电脑上的后端已启动，且手机与电脑在同一个 WiFi。`);
      }
    };

    void enter();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!native) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--px-sky)] p-6">
      <div className="px-panel max-w-sm p-6 text-center">
        <PixelIcon name="report" scale={3} />
        <p className="mt-4 text-[17px] leading-relaxed text-[var(--px-ink)]">{note}</p>
      </div>
    </div>
  );
}

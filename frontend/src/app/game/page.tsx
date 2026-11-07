import type { Metadata } from "next";
import { Suspense } from "react";
import GamePage from "./GamePage";

export const metadata: Metadata = { title: "城市经营 · CITY20" };

/** 路由用 query 形式 /game?session=xxx（09 §4.1：静态导出与四端壳共用同一路由形状） */
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="grid h-screen place-items-center text-fg-muted">
          加载中…
        </div>
      }
    >
      <GamePage />
    </Suspense>
  );
}

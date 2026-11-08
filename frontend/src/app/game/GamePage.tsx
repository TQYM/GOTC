"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import GameView from "@/components/game/GameView";
import { pickApi } from "@/lib/api";

export default function GamePage() {
  const params = useSearchParams();
  const id = params.get("session");
  const api = useMemo(() => pickApi(params), [params]);
  if (!id) {
    return (
      <div className="grid h-screen place-items-center">
        <Link
          href="/"
          className="px-action px-action-primary"
        >
          还没有城市，回首页创建
        </Link>
      </div>
    );
  }
  return <GameView api={api} id={id} debug={params.get("debug") === "1"} />;
}

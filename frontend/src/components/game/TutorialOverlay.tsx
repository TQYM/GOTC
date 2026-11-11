"use client";

/**
 * 首次进入的 5 步引导（C:S 的新手提示等价物）。
 *
 * 只做「读一遍就会玩」的最小集合：放置 → 速度 → 需求 → 划区 → 财政。
 * 进度记在 localStorage，同一浏览器只出现一次；随时可跳过。
 */

import { useEffect, useState } from "react";

const STEPS = [
  { title: "先放一栋住宅", body: "从底部工具栏选「低密住宅」，点地图上的空地放置。第一栋建筑决定城市能不能开始生长。" },
  { title: "让时间跑起来", body: "顶部中央是速度档：❚❚ 暂停 / ▶ 1x / ▶▶ 2x / ▶▶▶ 3x。C:S 的 3 档实际是 4 倍速，这里保持一致。" },
  { title: "盯住需求条", body: "左下角三条竖条是 RCI 需求。需求高时建造闸门才会放行新楼；楼建满、需求转负，城市就停止扩张。" },
  { title: "用刷子划一片区", body: "工具栏切到「批量划区」，拖一个矩形一次放多块。商业和工业只有被划出来才会长。" },
  { title: "看财政别破产", body: "左侧财政面板能调 5 类税率、借贷款。税率不是越高越好——它同时影响居民幸福与迁出。" },
];

const KEY = "city20.tutorial.v1";

export function TutorialOverlay() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(KEY)) return;
    setOpen(true);
  }, []);

  if (!open) return null;
  const current = STEPS[step];
  const close = () => {
    window.localStorage.setItem(KEY, "done");
    setOpen(false);
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-end justify-center bg-black/45 pb-24 backdrop-blur-sm">
      <div className="w-[min(92vw,30rem)] rounded-xl border border-white/15 bg-[#12161c]/95 p-5 text-white shadow-2xl">
        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-white/45">
          <span>上手 · {step + 1}/{STEPS.length}</span>
          <button type="button" onClick={close} className="hover:text-white">
            跳过
          </button>
        </div>
        <h3 className="text-lg font-semibold">{current.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/70">{current.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((item, index) => (
              <span
                key={item.title}
                className={`h-1.5 w-1.5 rounded-full ${
                  index === step ? "bg-emerald-400" : "bg-white/25"
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((value) => value - 1)}
                className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
              >
                上一步
              </button>
            )}
            <button
              type="button"
              onClick={() => (step === STEPS.length - 1 ? close() : setStep((value) => value + 1))}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400"
            >
              {step === STEPS.length - 1 ? "开始建设" : "下一步"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

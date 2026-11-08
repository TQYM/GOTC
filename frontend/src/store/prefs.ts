/**
 * 本端画面偏好（16 §5.2）：像素度只影响本设备渲染，不进存档、不走契约。
 * 存 localStorage；隐私模式等读写失败时退回默认值。
 */
import { create } from "zustand";

/** 每个「大像素」占多少 CSS 像素；0 = 关闭像素化（全分辨率渲染） */
export type PixelScale = 0 | 2 | 3;

const KEY = "city20.pixelScale";

function readStored(): PixelScale | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "0" || v === "2" || v === "3" ? (Number(v) as PixelScale) : null;
  } catch {
    return null;
  }
}

/** 默认：桌面 3×；触屏 2×（同时是性能优化，片元数降到约 1/4） */
export function defaultPixelScale(): PixelScale {
  return 0;
}

interface PrefsState {
  pixelScale: PixelScale | null;
  /** 首次在客户端读取存储值（SSR 期间保持 null，避免水合不一致） */
  hydrate: () => void;
  setPixelScale: (v: PixelScale) => void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  pixelScale: null,
  hydrate: () => {
    if (get().pixelScale !== null) return;
    set({ pixelScale: readStored() ?? defaultPixelScale() });
  },
  setPixelScale: (v) => {
    try {
      window.localStorage.setItem(KEY, String(v));
    } catch {
      /* 存不了就只在本次会话生效 */
    }
    set({ pixelScale: v });
  },
}));

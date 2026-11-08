"use client";

/**
 * 背景音乐（《紫禁岁月》北京中国古典乐团）。
 * 浏览器禁止无交互自动播放：先试 play()，被拦就等第一次 pointerdown/keydown 再播。
 * 音量压得很低，只当氛围垫底，不抢交互反馈。
 */
import { useEffect, useRef } from "react";

const SRC = "/audio/zijin-suijue.mp4";
const VOLUME = 0.28;

export default function Bgm() {
  const played = useRef(false);

  useEffect(() => {
    const audio = new Audio(SRC);
    audio.loop = true;
    audio.volume = VOLUME;
    audio.preload = "auto";

    const start = () => {
      if (played.current) return;
      audio
        .play()
        .then(() => {
          played.current = true;
        })
        .catch(() => {
          /* 等首次交互 */
        });
    };

    start();
    const onGesture = () => {
      start();
      if (played.current) {
        window.removeEventListener("pointerdown", onGesture);
        window.removeEventListener("keydown", onGesture);
      }
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);

    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      audio.pause();
      audio.src = "";
    };
  }, []);

  return null;
}

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "CITY20 · 城市更新沙盘",
  description: "AI 驱动的城市更新模拟沙盘：真实北京片区、卡通 3D、不限时经营",
};

export const viewport: Viewport = {
  themeColor: "#cfe6f2",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}

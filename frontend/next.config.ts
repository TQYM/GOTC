import type { NextConfig } from "next";

/** 同源反代避免开发态 CORS；关闭压缩以防止 SSE 被代理缓冲。 */
const API_BASE = (process.env.API_BASE ?? "http://localhost:8000").replace(/\/$/, "");

/** 离线包（桌面 HTML / Android APK）：静态导出，不再需要 next 服务器与代理 */
const OFFLINE = process.env.NEXT_PUBLIC_OFFLINE === "1";

const nextConfig: NextConfig = {
  ...(OFFLINE ? { output: "export" as const, trailingSlash: true } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  compress: false,
  // 127.0.0.1 与 localhost 混用时 dev 会拦 HMR（表现为水合不完整、页面卡在加载态）
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: { unoptimized: true },
  async rewrites() {
    if (OFFLINE) return [];
    return [
      { source: "/api/:path*", destination: `${API_BASE}/api/:path*` },
      { source: "/static/:path*", destination: `${API_BASE}/static/:path*` },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

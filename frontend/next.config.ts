import type { NextConfig } from "next";

/** 同源反代避免开发态 CORS；关闭压缩以防止 SSE 被代理缓冲。 */
const API_BASE = (process.env.API_BASE ?? "http://localhost:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: false,
  // 127.0.0.1 与 localhost 混用时 dev 会拦 HMR（表现为水合不完整、页面卡在加载态）
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async rewrites() {
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

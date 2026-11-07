import type { NextConfig } from "next";

/**
 * 后端地址（02 §0.3：同源部署）。浏览器只访问同源 /api/*，由 Next 反代到 FastAPI，
 * 开发态不需要后端开 CORS；`API_BASE` 只在服务端读取。
 */
const API_BASE = (process.env.API_BASE ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 关闭 Next 自带 gzip：否则反代的 SSE（text/event-stream）会被压缩缓冲，信息流收不到实时事件
  compress: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_BASE}/api/:path*` }];
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

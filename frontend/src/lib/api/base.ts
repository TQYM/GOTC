/**
 * 后端基址：Web 部署走同源反代（空串），静态包（APK / 本地 HTML）编译时注入绝对地址。
 * 例：NEXT_PUBLIC_API_BASE=http://23.185.168.190:17800
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

/** 把 /api/... 拼成可直接 fetch 的地址（已是绝对地址则原样返回） */
export function withBase(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

/**
 * 错误码 → 「一句人话 + 怎么办」（14 §2.1；02 错误码本身不变，映射表归前端文案）。
 */
import type { ApiError } from "./http";

export interface HumanError {
  title: string;
  hint?: string;
  /** 网络层失败才提供「重试」 */
  retryable?: boolean;
}

const yuan = (n: number) =>
  Math.abs(n) >= 10_000
    ? `${(n / 10_000).toFixed(n % 10_000 === 0 ? 0 : 1)} 万`
    : `${n} 元`;

export function humanizeError(
  err: ApiError,
  localReason?: string | null,
): HumanError {
  switch (err.code) {
    case "invalid_placement":
      return {
        title: localReason ?? "这里不能建",
        hint: "换一块绿色预览的空地试试",
      };
    case "cell_occupied":
      return {
        title: "这块地已经有建筑了",
        hint: "先拆除原有建筑，或换个位置",
      };
    case "insufficient_funds": {
      const cost = Number(err.details.cost);
      const funds = Number(err.details.funds);
      const gap =
        Number.isFinite(cost) && Number.isFinite(funds)
          ? `，还差 ${yuan(cost - funds)}`
          : "";
      return {
        title: `钱不够了${gap}`,
        hint: "快进一年收税，或拆掉建筑收回 30%",
      };
    }
    case "invalid_phase":
      return {
        title: "现在还不能这样操作",
        hint: "先点「开始规划」，或等推演结束",
      };
    case "session_not_found":
      return { title: "找不到这座城市", hint: "回首页重新创建" };
    case "invalid_payload":
      return { title: "请求格式不对（前端问题）", hint: "请刷新页面后重试" };
    case "network":
      return {
        title: "网络断了，操作没有发出去",
        hint: "检查网络后点「重试」",
        retryable: true,
      };
    default:
      return {
        title: "服务器开小差了",
        hint: "稍后点「重试」",
        retryable: true,
      };
  }
}

export { yuan };

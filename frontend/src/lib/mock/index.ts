/**
 * 前端 mock 数据（02 §0.2：mock 必须按契约 JSON 形状造）。
 *
 * session-882314.json 由后端真实生成器产出（seed=882314，契约 §3.2 GET 会话响应），
 * 已摆放全部 14 种区块用于渲染验收；切真后端时直接换成 REST 响应，零改动。
 */
import type { SessionState } from "@/lib/contract";
import raw from "./session-882314.json";

export const MOCK_SESSION = raw as unknown as SessionState;

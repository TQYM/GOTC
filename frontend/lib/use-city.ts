"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, eventsUrl, newClientOpId } from "./api";
import { rememberCity } from "./recent";
import { cityReducer, initialCityStore } from "./store";
import type {
  OperationResult,
  ProjectionResult,
  ReportResult,
  TileType,
} from "./types";

const SSE_EVENTS = [
  "snapshot", "op_applied", "city_year", "phase_change", "news", "citizen", "mentor", "report_ready",
];

export function useCity() {
  const [store, dispatch] = useReducer(cityReducer, initialCityStore);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ownOps = useRef(new Set<string>());
  const failedOps = useRef(new Map<string, string>());
  const state = store.state;
  const cityCode = state?.city_code;

  const recover = useCallback(async (code: string) => {
    try {
      const snapshot = await api.get(code);
      dispatch({ type: "snapshot", state: snapshot });
      setNotice("检测到序号缺口，已恢复全量城市状态");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "状态恢复失败，请稍后重试");
    }
  }, []);

  useEffect(() => {
    if (!cityCode) return;
    const source = new EventSource(eventsUrl(cityCode));
    const open = () => dispatch({ type: "connected", value: true });
    const disconnected = () => dispatch({ type: "connected", value: false });
    source.onopen = open;
    source.onerror = disconnected;
    const listeners = SSE_EVENTS.map((eventName) => {
      const listener = (raw: Event) => {
        const message = raw as MessageEvent<string>;
        try {
          const data = JSON.parse(message.data) as Record<string, unknown>;
          const clientOpId = typeof data.client_op_id === "string" ? data.client_op_id : null;
          dispatch({
            type: "sse",
            eventId: Number(message.lastEventId || 0),
            event: eventName,
            data,
            remote: clientOpId ? !ownOps.current.has(clientOpId) : true,
          });
        } catch {
          setError("收到无法解析的同步事件，正在恢复全量状态");
          void recover(cityCode);
        }
      };
      source.addEventListener(eventName, listener);
      return [eventName, listener] as const;
    });
    return () => {
      for (const [eventName, listener] of listeners) source.removeEventListener(eventName, listener);
      source.close();
      dispatch({ type: "connected", value: false });
    };
  }, [cityCode, recover]);

  useEffect(() => {
    if (store.needsRecovery && cityCode) void recover(cityCode);
  }, [store.needsRecovery, cityCode, recover]);

  useEffect(() => {
    if (state) rememberCity(state);
  }, [state]);

  const create = useCallback(async (name: string, parcelId: "beijing_cbd" | "sandbox") => {
    setBusy("create"); setError(null);
    try {
      const created = await api.create(name, parcelId);
      dispatch({ type: "snapshot", state: created });
      return created;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
      return null;
    } finally { setBusy(null); }
  }, []);

  const join = useCallback(async (code: string) => {
    setBusy("join"); setError(null);
    try {
      const joined = await api.get(code);
      dispatch({ type: "snapshot", state: joined });
      return joined;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加入失败");
      return null;
    } finally { setBusy(null); }
  }, []);

  const start = useCallback(async () => {
    if (!state) return null;
    setBusy("start"); setError(null);
    try {
      const started = await api.start(state.city_code);
      dispatch({ type: "snapshot", state: started });
      setNotice("规划已开启：点击地图放置，或在 occupied 格进行更新改造");
      return started;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法开始规划");
      return null;
    } finally { setBusy(null); }
  }, [state]);

  const operation = useCallback(async (
    op: OperationResult["op_type"],
    payload: Record<string, unknown>,
  ): Promise<OperationResult | null> => {
    if (!state) return null;
    const key = `${op}:${JSON.stringify(payload)}`;
    const clientOpId = failedOps.current.get(key) ?? newClientOpId();
    failedOps.current.set(key, clientOpId);
    ownOps.current.add(clientOpId);
    setBusy(op); setError(null);
    try {
      const result = await api.operation(
        state.city_code, op, clientOpId, state.last_seq, payload,
      );
      failedOps.current.delete(key);
      dispatch({ type: "operation", result, remote: false });
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? `${reason.message}；重试将复用操作 ID` : "操作失败，可安全重试");
      return null;
    } finally { setBusy(null); }
  }, [state]);

  const place = useCallback(async (
    type: TileType, anchor: [number, number], orientation?: "horizontal" | "vertical",
  ) => operation("place", { type, anchor, ...(type === "util_bridge" ? { orientation: orientation ?? "horizontal" } : {}) }), [operation]);

  const project = useCallback(async (years = 10): Promise<ProjectionResult | null> => {
    if (!state) return null;
    setBusy("project"); setError(null);
    try { return await api.project(state.city_code, years); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "推演失败"); return null; }
    finally { setBusy(null); }
  }, [state]);

  const report = useCallback(async (): Promise<ReportResult | null> => {
    if (!state) return null;
    setBusy("report"); setError(null);
    try {
      const created = await api.report(state.city_code);
      dispatch({ type: "report", report: created });
      return created;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "体检失败"); return null; }
    finally { setBusy(null); }
  }, [state]);

  const reports = useCallback(async (): Promise<ReportResult[]> => {
    if (!state) return [];
    try { return (await api.reports(state.city_code)).reports; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "报告历史读取失败"); return []; }
  }, [state]);

  const mentor = useCallback(async () => {
    if (!state) return false;
    setBusy("mentor"); setError(null);
    try {
      await api.mentor(state.city_code);
      setNotice("已请教规划导师，建议将通过信息流到达，不阻塞经营");
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导师暂时不可用"); return false; }
    finally { setBusy(null); }
  }, [state]);

  const leave = useCallback(() => {
    failedOps.current.clear(); ownOps.current.clear();
    dispatch({ type: "reset" }); setError(null); setNotice(null);
  }, []);

  const announce = useCallback((text: string) => setNotice(text), []);

  return {
    store, state, busy, error, notice, setError, setNotice, announce,
    create, join, start, operation, place, project, report, reports, mentor, leave, recover,
  };
}

export type CityController = ReturnType<typeof useCity>;

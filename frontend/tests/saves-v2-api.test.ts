import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent, StreamHandlers } from "@/lib/api";
import { createSavesV2Api } from "@/lib/api/savesV2";
import { makeOperation, makeState } from "./fixtures";

const streamMock = vi.hoisted(() => ({
  open: vi.fn(),
}));
vi.mock("@/lib/sse", () => ({ openEventStream: streamMock.open }));

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe("savesV2 适配器", () => {
  let handlers: StreamHandlers;
  let streamEvent: ReturnType<typeof vi.fn>;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    streamEvent = vi.fn();
    handlers = { onEvent: streamEvent, onConn: vi.fn() };
    streamMock.open.mockImplementation((_url: string, value: StreamHandlers) => {
      handlers = value;
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    streamMock.open.mockReset();
  });

  it("请求前登记 own-op，SSE 先于 HTTP 也不重复应用", async () => {
    const api = createSavesV2Api();
    api.subscribe("ABCD1234", handlers);
    const operation = makeOperation();
    let resolveFetch!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const placing = api.place("ABCD1234", { type: "res_low", anchor: [0, 1] });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.client_op_id).toBeTruthy();
    handlers.onEvent({ id: 900, event: "op_applied", data: { ...operation, client_op_id: body.client_op_id } });
    expect(streamEvent).not.toHaveBeenCalled();
    resolveFetch(response({ ...operation, client_op_id: body.client_op_id, tile: { id: "t1", type: "res_low", cells: [[0, 1]], anchor: [0, 1], orientation: null, built_at_year: 1, upkeep: 100 } }));
    await placing;
    expect(streamEvent).not.toHaveBeenCalled();
    handlers.onEvent({ id: 901, event: "op_applied", data: { ...operation, client_op_id: "remote", seq: 2 } });
    expect(streamEvent).toHaveBeenCalledOnce();
  });

  it("网络失败后的同一操作复用 client_op_id，成功后新操作换 ID", async () => {
    const api = createSavesV2Api();
    const tile = { id: "t1", type: "res_low" as const, cells: [[0, 1]] as [number, number][], anchor: [0, 1] as [number, number], orientation: null, built_at_year: 1, upkeep: 100 };
    fetchMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(response(makeOperation({ tile })))
      .mockResolvedValueOnce(response(makeOperation({ seq: 2, tile: { ...tile, id: "t2" } })));
    const input = { type: "res_low" as const, anchor: [0, 1] as [number, number] };
    await expect(api.place("ABCD1234", input)).rejects.toThrow();
    await api.place("ABCD1234", input);
    await api.place("ABCD1234", { ...input, anchor: [1, 1] });
    const ids = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body as string).client_op_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[1]);
  });

  it("断线 snapshot 转为内部快照并保留独立 event id", () => {
    const api = createSavesV2Api();
    api.subscribe("ABCD1234", handlers);
    const state = makeState({ last_seq: 7 });
    handlers.onEvent({ id: 123456789, event: "snapshot", data: state } as unknown as StreamEvent);
    expect(streamEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: 123456789,
      event: "snapshot",
      data: expect.objectContaining({ id: "ABCD1234", lastSeq: 7 }),
    }));
  });
});

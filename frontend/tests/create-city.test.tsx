import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateCity from "@/app/CreateCity";

const mocks = vi.hoisted(() => ({ push: vi.fn(), create: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, pickApi: () => ({ create: mocks.create }) };
});

describe("创建与加入城市", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.create.mockReset().mockResolvedValue({ id: "REAL2026" });
  });

  it("默认创建北京真实片区，保留城市名并进入新路由", async () => {
    render(<CreateCity />);
    fireEvent.change(screen.getByRole("textbox", { name: /城市名称/ }), { target: { value: "朝阳试验城" } });
    fireEvent.click(screen.getByTestId("create-city"));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
      name: "朝阳试验城", parcelId: "beijing_core", seed: undefined,
    }));
    expect(mocks.push).toHaveBeenCalledWith("/game?session=REAL2026");
  });

  it("沙盒模式传递确定性 seed", async () => {
    render(<CreateCity />);
    fireEvent.click(screen.getByRole("radio", { name: "确定性练习沙盒" }));
    fireEvent.change(screen.getByLabelText("种子"), { target: { value: "42" } });
    fireEvent.click(screen.getByTestId("create-city"));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ parcelId: "sandbox", seed: 42 })));
  });

  it("城市码规范为大写，8 位才可加入", async () => {
    render(<CreateCity />);
    const input = screen.getByLabelText(/城市码/);
    fireEvent.change(input, { target: { value: "abcd1234" } });
    expect(input).toHaveValue("ABCD1234");
    fireEvent.click(screen.getByTestId("join-city"));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/game?session=ABCD1234"));
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

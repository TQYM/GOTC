import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import HomeScreen from "../components/home-screen";

describe("创建与加入", () => {
  it("默认创建真实北京，并使用 8 位城市码加入", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({});
    const onJoin = vi.fn().mockResolvedValue({});
    const onError = vi.fn();
    render(<HomeScreen busy={null} error={null} onCreate={onCreate} onJoin={onJoin} onError={onError} />);
    await user.click(screen.getByRole("button", { name: "创建并进入城市" }));
    expect(onCreate).toHaveBeenCalledWith("我的 CBD 更新计划", "beijing_cbd");

    const input = screen.getByLabelText("8 位城市码");
    await user.type(input, "abc");
    await user.click(screen.getByRole("button", { name: "加入城市" }));
    expect(onError).toHaveBeenCalledWith("城市码应为 8 位字母或数字");
    await user.clear(input);
    await user.type(input, "abcd1234");
    await user.click(screen.getByRole("button", { name: "加入城市" }));
    expect(onJoin).toHaveBeenCalledWith("ABCD1234");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProjectionPlayer from "../components/projection-player";
import ReportDialog from "../components/report-dialog";
import { makeProjection, makeReport, makeState } from "./fixtures";

describe("独立推演与报告 UI", () => {
  it("播放器只改变自己的索引，可返回真实城市", async () => {
    const user = userEvent.setup();
    const projection = makeProjection();
    const authoritative = makeState();
    const onClose = vi.fn();
    render(<ProjectionPlayer result={projection} onClose={onClose} />);
    expect(screen.getByRole("heading", { name: "第 2 年 · 只读推演" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一年" }));
    expect(screen.getByRole("heading", { name: "第 3 年 · 只读推演" })).toBeInTheDocument();
    expect(authoritative.city_year).toBe(1);
    expect(projection.base_year).toBe(1);
    await user.click(screen.getByRole("button", { name: "返回真实城市，继续经营" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("体检显示五维与历史，关闭不是终局", async () => {
    const user = userEvent.setup();
    const report = makeReport();
    const onClose = vi.fn();
    render(<ReportDialog report={report} history={[report]} busy={false} onSelect={vi.fn()} onRefresh={vi.fn()} onClose={onClose} />);
    expect(screen.getByRole("img", { name: "五维城市体检雷达图" })).toBeInTheDocument();
    expect(screen.getByText("不是终局。关闭后可继续经营。", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "历史城市体检" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "继续经营" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

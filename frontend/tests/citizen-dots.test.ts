import { describe, expect, it } from "vitest";
import { agentPosition } from "@/components/scene/CitizenDots";

const agent = { hx: 0, hz: 0, cx: 100, cz: 0, dx: 100, dz: 100 };

describe("agentPosition（市民通勤移动）", () => {
  it("t=0 在出发点", () => {
    expect(agentPosition(agent, 0)).toEqual({ x: 0, z: 0 });
  });

  it("t=1 在目的地", () => {
    const end = agentPosition(agent, 1);
    expect(end.x).toBeCloseTo(100, 6);
    expect(end.z).toBeCloseTo(100, 6);
  });

  it("沿 L 形折线走：先到拐点，再转向目的地", () => {
    const half = agentPosition(agent, 0.5);
    expect(half.x).toBeCloseTo(100, 6);
    expect(half.z).toBeCloseTo(0, 6);
    const later = agentPosition(agent, 0.75);
    expect(later.x).toBeCloseTo(100, 6);
    expect(later.z).toBeCloseTo(50, 6);
  });

  it("两段不等长时按长度加权，拐点两侧连续", () => {
    // 第一段 10、第二段 100，拐点在 t = 10/110 ≈ 0.0909
    const uneven = { hx: 0, hz: 0, cx: 10, cz: 0, dx: 110, dz: 0 };
    const before = agentPosition(uneven, 0.09).x; // 第一段末尾
    const after = agentPosition(uneven, 0.1).x; // 第二段开头
    expect(before).toBeCloseTo(9.9, 6);
    expect(after).toBeCloseTo(11, 6);
    // 若按「两段各占一半时间」实现，before 会到 18、after 会跳回 10 —— 这里不允许跳
    expect(after - before).toBeLessThan(2);
  });

  it("越界 t 被夹取", () => {
    expect(agentPosition(agent, -1)).toEqual({ x: 0, z: 0 });
    expect(agentPosition(agent, 2)).toEqual({ x: 100, z: 100 });
  });
});

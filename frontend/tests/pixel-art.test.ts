import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TILE_ORDER } from "@/lib/catalog";
import { PX } from "@/lib/palette";
import { ICON_NAMES, iconRows, iconSprite, rawRowWidth, tileSprite } from "@/lib/pixelArt";

describe("像素图标（16 §4.3）", () => {
  it.each(ICON_NAMES)("%s：16 行、每行恰好 16 格", (name) => {
    const rows = iconRows(name);
    expect(rows).toHaveLength(16);
    rows.forEach((row) => expect(rawRowWidth(row), `${name}: ${row}`).toBe(16));
  });

  it("每个图标都有墨色描边层", () => {
    for (const name of ICON_NAMES) {
      expect(iconSprite(name).layers.some((l) => l.c === PX.ink)).toBe(true);
    }
  });
});

describe("区块等距缩略图", () => {
  it.each(TILE_ORDER)("%s：输出非空像素层且尺寸为 24×28", (type) => {
    const sprite = tileSprite(type);
    expect(sprite.w).toBe(24);
    expect(sprite.h).toBe(28);
    expect(sprite.layers.length).toBeGreaterThan(3);
    expect(sprite.layers.every((l) => l.d.length > 0)).toBe(true);
  });
});

describe("色板一致性（16 §7 DoD）", () => {
  it("globals.css 的 --px-* 变量与 palette.ts 的 PX 一一对应", () => {
    const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
    for (const [key, value] of Object.entries(PX)) {
      const m = new RegExp(`--px-${key}:\\s*(#[0-9A-Fa-f]{6});`).exec(css);
      expect(m, `--px-${key} 缺失`).not.toBeNull();
      expect(m![1].toUpperCase()).toBe(value.toUpperCase());
    }
  });
});

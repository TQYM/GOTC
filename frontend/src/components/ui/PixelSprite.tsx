/**
 * 像素图标 / 区块缩略图（16 §4.3）：每种颜色一条 path，crispEdges 渲染，整数倍缩放。
 */
import type { TileType } from "@/lib/contract";
import { iconSprite, tileSprite, type IconName, type Sprite } from "@/lib/pixelArt";

function SpriteSvg({ sprite, scale, className }: { sprite: Sprite; scale: number; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${sprite.w} ${sprite.h}`}
      width={sprite.w * scale}
      height={sprite.h * scale}
      className={`px-sprite shrink-0 ${className ?? ""}`}
      aria-hidden
      focusable="false"
    >
      {sprite.layers.map((l) => (
        <path key={l.c} d={l.d} fill={l.c} />
      ))}
    </svg>
  );
}

/** 16×16 功能图标；scale 取整数（1 → 16px，2 → 32px） */
export function PixelIcon({ name, scale = 2, className }: { name: IconName; scale?: number; className?: string }) {
  return <SpriteSvg sprite={iconSprite(name)} scale={scale} className={className} />;
}

/** 区块等距缩略图（24×28 逻辑像素） */
export function TileThumb({ type, scale = 2, className }: { type: TileType; scale?: number; className?: string }) {
  return <SpriteSvg sprite={tileSprite(type)} scale={scale} className={className} />;
}

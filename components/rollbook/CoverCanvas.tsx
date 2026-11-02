'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { CoverData, CoverElement, CoverLayout, fillCoverTokens } from '@/lib/coverLayout';

const KAI = "'標楷體','KaiTi','DFKai-SB','BiauKai',serif";

function elementStyle(el: CoverElement): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    left: `${el.x}mm`,
    top: `${el.y}mm`,
    width: `${el.w}mm`,
    height: `${el.h}mm`,
    zIndex: el.z,
    boxSizing: 'border-box',
  };
  if (el.kind === 'text') {
    const justify = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center';
    return {
      ...base,
      display: 'flex',
      alignItems: 'center',
      justifyContent: justify,
      textAlign: el.align ?? 'center',
      fontFamily: KAI,
      fontSize: `${el.fontPt ?? 20}pt`,
      fontWeight: el.bold ? 700 : 400,
      color: el.color ?? '#000',
      lineHeight: 1.15,
      whiteSpace: 'pre-wrap',
      writingMode: el.vertical ? 'vertical-rl' : undefined,
      letterSpacing: el.spacing ? `${el.spacing / 100}em` : undefined,
      WebkitTextStroke: el.strokePx ? `${el.strokePx}px ${el.strokeColor ?? '#000'}` : undefined,
      paintOrder: el.strokePx ? ('stroke fill' as any) : undefined,
      textShadow: el.glow ? '0 0 12px rgba(91,155,213,0.7)' : undefined,
      border: el.borderPx ? `${el.borderPx}px solid #000` : undefined,
    };
  }
  return base;
}

// 把封面版面畫出來。列印時不帶 interactive；編輯頁帶 interactive 才能點選、拖曳與縮放。
export default function CoverCanvas({
  layout,
  data,
  interactive,
}: {
  layout: CoverLayout;
  data: CoverData;
  interactive?: {
    selectedId: string | null;
    onPointerDown: (e: ReactPointerEvent, el: CoverElement, mode: 'move' | 'resize') => void;
  };
}) {
  const els = [...layout.elements].sort((a, b) => a.z - b.z);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {els.map((el) => {
        const selected = interactive?.selectedId === el.id;
        const style = elementStyle(el);
        const outline: CSSProperties = interactive
          ? { outline: selected ? '2px solid #1a73e8' : '1px dashed rgba(0,0,0,0.18)', cursor: 'move', touchAction: 'none' }
          : {};
        return (
          <div key={el.id} style={{ ...style, ...outline }} onPointerDown={interactive ? (e) => interactive.onPointerDown(e, el, 'move') : undefined}>
            {el.kind === 'text' ? (
              <span style={{ pointerEvents: 'none' }}>{fillCoverTokens(el.text ?? '', data)}</span>
            ) : el.src ? (
              <img
                src={el.src}
                alt=""
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: el.fit === 'fill' ? 'fill' : el.fit ?? 'cover', opacity: el.opacity ?? 1, pointerEvents: 'none', display: 'block' }}
              />
            ) : null}
            {interactive && selected && (
              <span
                onPointerDown={(e) => {
                  e.stopPropagation();
                  interactive.onPointerDown(e, el, 'resize');
                }}
                style={{ position: 'absolute', right: -5, bottom: -5, width: 12, height: 12, background: '#1a73e8', border: '2px solid #fff', borderRadius: 3, cursor: 'nwse-resize', touchAction: 'none', zIndex: 9999 }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

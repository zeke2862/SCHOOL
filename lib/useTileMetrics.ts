'use client';

import { useEffect, useState } from 'react';

// 方形功能按鈕（首頁、各入口的功能選單）的自動大小：
//   * 按鈕區整體佔畫面高度的約 2/3（share=0.66），按鈕少就放大、按鈕多（例如管理職）就自動縮小；
//   * 手機一欄或兩欄、平板三欄、電腦四欄；
//   * 標題字級跟著按鈕大小走，使用者還是可以再用上方「字級 小／中／大」自己微調。
export type TileMetrics = { cols: number; tileH: number; titleSize: number; descSize: number; gap: number; mobile: boolean; tileW: number };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function computeTileMetrics(count: number, vw: number, vh: number, share = 0.66, maxWidth = 1000, padX = 28): TileMetrics {
  const mobile = vw <= 640;
  const cols = count <= 1 ? 1 : vw < 420 ? (count <= 4 ? 1 : 2) : vw < 700 ? 2 : vw < 1000 ? 3 : 4;
  const gap = mobile ? 10 : 14;
  const rows = Math.max(1, Math.ceil(count / cols));
  const usable = vh * share - (rows - 1) * gap;
  const tileH = Math.round(clamp(usable / rows, mobile ? 84 : 96, mobile ? 200 : 170));
  const tileW = (Math.min(vw, maxWidth) - padX - gap * (cols - 1)) / cols;
  return {
    cols,
    tileH,
    gap,
    mobile,
    tileW,
    titleSize: clamp(Math.round(tileH * 0.21), 17, 28),
    descSize: clamp(Math.round(tileH * 0.105), 12, 15),
  };
}

export function useTileMetrics(count: number, share = 0.66, maxWidth = 1000, padX = 28): TileMetrics {
  const [vp, setVp] = useState({ w: 390, h: 800 });
  useEffect(() => {
    const read = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return computeTileMetrics(count, vp.w, vp.h, share, maxWidth, padX);
}

/** 所有按鈕的標題裡，需要最多行的那一個是幾行（中文一個字約一個字級寬）；
 *  每顆按鈕的標題區都用這個行數當高度，這樣不管標題是一行還是兩行，下面的說明都從同一條線開始。 */
export function maxTitleLines(labels: string[], tm: TileMetrics): number {
  const usable = Math.max(40, tm.tileW - 28);
  return Math.max(1, ...labels.map((l) => Math.ceil((Array.from(l).length * tm.titleSize) / usable)));
}

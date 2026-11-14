'use client';

import { useEffect, useState } from 'react';

// 在 LINE 裡點連結，預設會用 LINE 內建瀏覽器開啟：登入狀態和一般瀏覽器分開、檔案下載與列印常常不能用。
// LINE 官方支援在網址加上 openExternalBrowser=1，就會改用手機預設瀏覽器開啟。
//   1. 老師從 LINE 點進來時，這裡偵測到是 LINE 內建瀏覽器，就自動補上這個參數重新開啟一次。
//   2. 如果仍停在 LINE 裡（舊版 LINE 或 iOS 某些情況），畫面上方顯示提示，可一鍵複製網址、改用瀏覽器貼上。
// 只在 LINE 內建瀏覽器才會動作；一般瀏覽器完全不受影響。
const PARAM = 'openExternalBrowser';

export default function OpenInBrowser() {
  const [stuck, setStuck] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      if (!/\bLine\//i.test(navigator.userAgent)) return;
      const u = new URL(window.location.href);
      if (u.searchParams.get(PARAM) === '1') {
        // 已經帶過參數卻還在 LINE 裡：不再重複導向，改顯示提示
        setStuck(true);
        return;
      }
      u.searchParams.set(PARAM, '1');
      window.location.replace(u.toString());
    } catch {
      /* 偵測失敗就當作一般瀏覽器 */
    }
  }, []);

  if (!stuck) return null;
  const url = (() => {
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete(PARAM);
      return u.toString();
    } catch {
      return '';
    }
  })();
  return (
    <div className="no-print" role="status" style={{ background: '#FFF4D6', borderBottom: '1px solid #E4D5A8', color: '#8A5A00', padding: '8px 12px', fontSize: 13, lineHeight: 1.6 }}>
      目前是在 LINE 內建瀏覽器，登入與下載可能不穩。請點右下角「⋯」或右上角選單，選「用預設瀏覽器開啟」，或
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            window.prompt('複製這個網址，貼到瀏覽器開啟', url);
          }
        }}
        style={{ margin: '0 4px', padding: '2px 10px', borderRadius: 6, border: '1px solid #8A5A00', background: '#fff', color: '#8A5A00', cursor: 'pointer', fontSize: 13, minHeight: 0 }}
      >
        {copied ? '已複製' : '複製網址'}
      </button>
      後貼到 Chrome／Safari。
    </div>
  );
}

'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// Cloudflare Turnstile 人機驗證（免費）。資安檢測報告 #8：擋掉用程式大量猜密碼。
// 只有設定了環境變數 NEXT_PUBLIC_TURNSTILE_SITE_KEY 才會出現；沒設定時整個元件不顯示、登入流程跟以前完全一樣。
// 啟用步驟見 docs/效能與資安檢測報告_2026-11-20.md 的「第二級」說明：
//   1) Cloudflare 建 Turnstile 站點取得 Site Key／Secret Key；
//   2) Supabase 後台 Authentication → Attack Protection 開啟 CAPTCHA、填 Secret Key；
//   3) Vercel 設定 NEXT_PUBLIC_TURNSTILE_SITE_KEY 後重新部署。（步驟 2、3 要在同一段時間內完成，否則會暫時登不進去）
// Supabase 一旦開啟 CAPTCHA，登入與寄「忘記密碼」信都必須帶驗證結果，所以這個元件要放在這兩個表單旁邊。

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

export type TurnstileHandle = { reset: () => void };

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

const TurnstileWidget = forwardRef<TurnstileHandle, { onToken: (token: string | null) => void }>(function TurnstileWidget({ onToken }, ref) {
  const boxRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useImperativeHandle(ref, () => ({
    reset: () => {
      onTokenRef.current(null);
      if (window.turnstile && idRef.current) window.turnstile.reset(idRef.current);
    },
  }));

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;

    function renderWidget() {
      if (cancelled || !boxRef.current || !window.turnstile || idRef.current) return;
      idRef.current = window.turnstile.render(boxRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t: string) => onTokenRef.current(t),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => onTokenRef.current(null),
      });
    }

    if (window.turnstile) {
      renderWidget();
    } else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      if (!script) {
        script = document.createElement('script');
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', renderWidget);
    }

    return () => {
      cancelled = true;
      if (window.turnstile && idRef.current) window.turnstile.remove(idRef.current);
      idRef.current = null;
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={boxRef} style={{ minHeight: 65 }} />;
});

export default TurnstileWidget;

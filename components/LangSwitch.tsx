'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { translateText } from '@/lib/i18nDict';

// 家長／學生用的「中文 / ไทย」語言切換（預設中文）。
// 只在首頁（選擇身分、登入）與家長／學生入口（/portal…）、設定新密碼頁出現；教職員使用的頁面維持中文。
// 選泰文時，畫面上的中文文字（含 placeholder、提示、alert 訊息）會依 lib/i18nDict.ts 換成泰文，
// 之後畫面更新出現的新文字也會自動換；切回中文會重新載入頁面。語言選擇記在這個瀏覽器（localStorage）。

const STORAGE_KEY = 'ui_lang';
const ATTRS = ['placeholder', 'title', 'aria-label'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);

function inScope(path: string | null) {
  return path === '/' || !!path?.startsWith('/portal') || path === '/change-password';
}

export default function LangSwitch() {
  const pathname = usePathname();
  const [lang, setLang] = useState<'zh' | 'th'>('zh');

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'th') setLang('th');
    } catch {
      /* 讀不到就用中文 */
    }
  }, []);

  useEffect(() => {
    if (lang !== 'th' || !inScope(pathname)) return;
    document.documentElement.lang = 'th';

    // 節點 → 它現在顯示的泰文；內容和這個一樣就代表是我們換的，不用再處理
    const textDone = new WeakMap<Node, string>();
    const attrDone = new WeakMap<Element, Record<string, string>>();

    const doText = (n: Node) => {
      const v = n.nodeValue ?? '';
      if (textDone.get(n) === v) return;
      const parent = n.parentElement;
      if (parent && SKIP_TAGS.has(parent.tagName)) return;
      const out = translateText(v);
      textDone.set(n, out);
      if (out !== v) n.nodeValue = out;
    };
    const doAttrs = (el: Element) => {
      let rec = attrDone.get(el);
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        if (rec && rec[a] === v) continue;
        const out = translateText(v);
        (rec ??= {})[a] = out;
        if (out !== v) el.setAttribute(a, out);
      }
      if (rec) attrDone.set(el, rec);
    };
    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) return doText(root);
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      const el = root as Element;
      if (SKIP_TAGS.has(el.tagName)) return;
      doAttrs(el);
      el.childNodes.forEach(walk);
    };

    walk(document.body);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });

    // alert / confirm / prompt 的訊息也翻成泰文
    const w = window as any;
    const orig = { alert: w.alert, confirm: w.confirm, prompt: w.prompt };
    w.alert = (msg?: any) => orig.alert.call(window, translateText(String(msg ?? '')));
    w.confirm = (msg?: any) => orig.confirm.call(window, translateText(String(msg ?? '')));
    w.prompt = (msg?: any, def?: any) => orig.prompt.call(window, translateText(String(msg ?? '')), def);

    return () => {
      obs.disconnect();
      w.alert = orig.alert;
      w.confirm = orig.confirm;
      w.prompt = orig.prompt;
    };
  }, [lang, pathname]);

  if (!inScope(pathname)) return null;

  function choose(next: 'zh' | 'th') {
    if (next === lang) return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 存不起來也先切換這一次 */
    }
    if (next === 'zh') {
      window.location.reload(); // 還原所有已翻譯的文字
    } else {
      setLang('th');
    }
  }

  const btn = (code: 'zh' | 'th', label: string) => (
    <button
      type="button"
      onClick={() => choose(code)}
      aria-pressed={lang === code}
      className="keep-size no-print"
      style={{
        padding: '6px 12px',
        border: 'none',
        borderRadius: 999,
        fontSize: 13,
        minHeight: 0,
        cursor: 'pointer',
        background: lang === code ? '#2C2C2A' : 'transparent',
        color: lang === code ? '#fff' : '#2C2C2A',
        fontWeight: lang === code ? 700 : 400,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="no-print"
      translate="no"
      style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 9998, display: 'flex', gap: 2, padding: 3, background: '#fff', border: '1px solid #ccc', borderRadius: 999, boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}
    >
      {btn('zh', '中文')}
      {btn('th', 'ไทย')}
    </div>
  );
}

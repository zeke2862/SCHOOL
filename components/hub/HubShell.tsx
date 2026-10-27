'use client';

import Link from 'next/link';
import { ReactNode, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getHub, hubVisibleTabs } from '@/lib/permissions';
import { useCaps } from '@/lib/useCaps';
import { useTileMetrics, maxTitleLines } from '@/lib/useTileMetrics';
import { loadSiteContentCached, SITE_CONTENT_DEFAULTS, hubLabelKey, tabLabelKey, tabHintKey } from '@/lib/siteContent';

// 整合入口的共用外殼：
//   1. 點進入口（沒有 ?tab=）先看到「方形按鈕」總覽，跟首頁一樣，只列出這個身分有權限的功能；
//   2. 再點某個按鈕才進到該功能的完整頁面，頁面最上方用「入口名稱 › 功能名稱」告訴使用者現在在哪裡，
//      點入口名稱就回到按鈕總覽，旁邊也列出同一入口的其他功能可以直接切換；
//   3. 入口只有一個功能時，直接顯示內容（不需要多一層選擇）。
// 沒權限的功能根本不出現，直接輸入網址（?tab=不屬於自己的功能）會退回按鈕總覽。
// renderers：每個功能要顯示的內容（用函式延遲建立，沒進去的功能不會載入）。

function HubShellInner({ hubKey, renderers }: { hubKey: string; renderers: Record<string, () => ReactNode> }) {
  const hub = getHub(hubKey);
  const { caps, loading } = useCaps();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');

  const tabs = caps ? hubVisibleTabs(hub, caps) : [];
  const tm = useTileMetrics(tabs.length);
  // 系統管理員在「系統文字管理」改過的名稱與說明；沒改過的用程式裡的原文
  const [texts, setTexts] = useState<Record<string, string>>(SITE_CONTENT_DEFAULTS);
  useEffect(() => {
    loadSiteContentCached().then(setTexts).catch(() => {});
  }, []);
  const hubName = texts[hubLabelKey(hubKey)] ?? hub.label;
  const tabName = (k: string, fallback: string) => texts[tabLabelKey(hubKey, k)] || fallback;
  const tabHint = (k: string, fallback?: string) => texts[tabHintKey(hubKey, k)] ?? fallback ?? '';
  const titleLines = maxTitleLines(tabs.map((t) => tabName(t.key, t.label)), tm);

  if (loading) return <p style={{ padding: 24, fontSize: 13, color: '#999' }}>載入中…</p>;

  if (!caps || tabs.length === 0) {
    return (
      <main style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16, marginBottom: 8 }}>沒有可用的功能</h1>
        <p style={{ fontSize: 13, color: '#999' }}>
          「{hubName}」目前沒有開放給您的身分使用。如果您認為應該要有，請聯絡學校管理員確認您的職務設定。
        </p>
      </main>
    );
  }

  const current = tabs.length === 1 ? tabs[0] : tabs.find((t) => t.key === requested) ?? null;

  // ---- 按鈕總覽 ----
  if (!current) {
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 14px 40px' }}>
        <h1 className="no-print" style={{ textAlign: 'center', margin: '0 0 6px' }}>
          {hubName}
        </h1>
        <p className="no-print" style={{ fontSize: tm.mobile ? 15 : 14, color: '#888', textAlign: 'center', margin: '0 0 18px' }}>
          請選擇要使用的功能
        </p>
        <div className="no-print" style={{ display: 'grid', gridTemplateColumns: `repeat(${tm.cols}, minmax(0, 1fr))`, gap: tm.gap }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => router.push(`${hub.href}?tab=${t.key}`)}
              style={{
                height: tm.tileH,
                padding: 12,
                background: '#fff',
                border: '1px solid #e5e2da',
                borderRadius: 12,
                color: '#2C2C2A',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                gap: 6,
                font: 'inherit',
              }}
            >
              {/* 標題區高度統一：以字最多（行數最多）的那顆為準，所有按鈕的說明才會對齊 */}
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: Math.round(titleLines * tm.titleSize * 1.3), fontSize: tm.titleSize, fontWeight: 700, lineHeight: 1.3 }}>
                {tabName(t.key, t.label)}
              </span>
              {tabHint(t.key, t.hint) && tm.tileH >= 110 + (titleLines - 1) * tm.titleSize && (
                <span style={{ fontSize: tm.descSize, color: '#888', lineHeight: 1.35 }}>{tabHint(t.key, t.hint)}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- 功能頁面 ----
  const render = renderers[current.key];
  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '16px 12px' }}>
      <nav className="no-print" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '0 12px 6px', fontSize: 14 }}>
        {tabs.length > 1 ? (
          <Link href={hub.href} style={{ color: '#2C6E9E', textDecoration: 'none' }}>
            {hubName}
          </Link>
        ) : (
          <span style={{ color: '#888' }}>{hubName}</span>
        )}
        <span style={{ color: '#aaa' }}>›</span>
        <b>{tabName(current.key, current.label)}</b>
      </nav>
      {tabs.length > 1 && (
        <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 12px 8px', paddingBottom: 8, borderBottom: '1px solid #eee' }}>
          {tabs
            .filter((t) => t.key !== current.key)
            .map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => router.push(`${hub.href}?tab=${t.key}`)}
                style={{ padding: '3px 10px', fontSize: 12, border: '1px solid #e0ddd4', background: '#fafaf8', borderRadius: 999, color: '#6b6b66', cursor: 'pointer' }}
              >
                {tabName(t.key, t.label)}
              </button>
            ))}
        </div>
      )}
      <div key={current.key}>{render ? render() : null}</div>
    </div>
  );
}

export default function HubShell(props: { hubKey: string; renderers: Record<string, () => ReactNode> }) {
  return (
    <Suspense fallback={<p style={{ padding: 24, fontSize: 13, color: '#999' }}>載入中…</p>}>
      <HubShellInner {...props} />
    </Suspense>
  );
}

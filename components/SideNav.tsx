'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCaps } from '@/lib/useCaps';
import { visibleHubs, type HubDef } from '@/lib/permissions';
import { loadSiteContentCached, hubLabelKey } from '@/lib/siteContent';
import HubIcon from '@/components/hub/HubIcon';

// 方案 B：電腦版＝左側固定導覽；手機版＝底部四顆大按鈕（首頁／功能／通知／帳號），
// 「功能」點開是大按鈕面板，拇指一手就點得到。只列出這個身分有權限的入口（跟首頁同一套規則）。
// 純 CSS 版面＋內建 emoji 圖示，不載入圖片、不新增查詢（身分資料沿用既有快取）。

function useHubs() {
  const { caps } = useCaps();
  const [texts, setTexts] = useState<Record<string, string>>({});
  useEffect(() => {
    loadSiteContentCached().then(setTexts).catch(() => {});
  }, []);
  const hubs = caps ? visibleHubs(caps) : [];
  const label = (h: HubDef) => texts[hubLabelKey(h.key)] || h.label;
  return { hubs, label };
}

export default function SideNav() {
  const pathname = usePathname() ?? '';
  const { hubs, label } = useHubs();
  const [sheet, setSheet] = useState(false);

  // 換頁就把面板收起來
  useEffect(() => {
    setSheet(false);
  }, [pathname]);

  if (hubs.length === 0) return null;
  const active = (h: HubDef) => pathname === h.href || pathname.startsWith(h.href + '/');
  const teach = hubs.filter((h) => h.group === 'teach');
  const manage = hubs.filter((h) => h.group === 'manage');

  const item = (h: HubDef) => (
    <Link key={h.key} href={h.href} className={'sn-item' + (active(h) ? ' on' : '')} aria-current={active(h) ? 'page' : undefined}>
      <HubIcon hubKey={h.key} size={26} />
      <span>{label(h)}</span>
    </Link>
  );

  return (
    <>
      <aside className="sn-side no-print" aria-label="功能選單">
        <Link href="/admin" className={'sn-item' + (pathname === '/admin' ? ' on' : '')}>
          <span className="sn-home" aria-hidden="true">🏠</span>
          <span>首頁</span>
        </Link>
        {teach.length > 0 && <div className="sn-group">教學作業</div>}
        {teach.map(item)}
        {manage.length > 0 && <div className="sn-group">行政管理</div>}
        {manage.map(item)}
      </aside>

      <nav className="sn-bottom no-print" aria-label="快速選單">
        <Link href="/admin" className={pathname === '/admin' ? 'on' : ''}>
          <span aria-hidden="true">🏠</span>首頁
        </Link>
        <button type="button" className={'keep-size' + (sheet ? ' on' : '')} onClick={() => setSheet((v) => !v)} aria-expanded={sheet}>
          <span aria-hidden="true">▦</span>功能
        </button>
        <Link href="/notifications" className={pathname.startsWith('/notifications') ? 'on' : ''}>
          <span aria-hidden="true">🔔</span>通知
        </Link>
        <Link href="/account" className={pathname.startsWith('/account') ? 'on' : ''}>
          <span aria-hidden="true">👤</span>帳號
        </Link>
      </nav>

      {sheet && (
        <div className="sn-sheet no-print" role="dialog" aria-label="全部功能" onClick={() => setSheet(false)}>
          <div className="sn-panel" onClick={(e) => e.stopPropagation()}>
            {[{ t: '教學作業', l: teach }, { t: '行政管理', l: manage }].map(
              (g) =>
                g.l.length > 0 && (
                  <section key={g.t}>
                    <div className="sn-group">{g.t}</div>
                    <div className="sn-grid">
                      {g.l.map((h) => (
                        <Link key={h.key} href={h.href} className={active(h) ? 'on' : ''}>
                          <HubIcon hubKey={h.key} size={40} />
                          <span>{label(h)}</span>
                        </Link>
                      ))}
                    </div>
                  </section>
                ),
            )}
          </div>
        </div>
      )}
    </>
  );
}

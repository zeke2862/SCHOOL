'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadSiteContentCached, SITE_CONTENT_DEFAULTS, hubLabelKey, hubDescKey, extraLabelKey } from '@/lib/siteContent';
import { BulletinPost, getPublishedPosts } from '@/lib/bulletin';
import { useCaps } from '@/lib/useCaps';
import { visibleHubs, hubVisibleTabs, type HubDef } from '@/lib/permissions';
import { useIsMobile } from '@/lib/useIsMobile';
import { useTileMetrics, maxTitleLines, TileMetrics } from '@/lib/useTileMetrics';

// 布告欄關卡：有新公告時，先看過按「我知道」才放行（用 localStorage 記看到哪一篇）。
const BULLETIN_ACK_KEY = 'admin_bulletin_ack_published_at';
const MANAGE_OPEN_KEY = 'admin_home_manage_open';

function BulletinGate({ posts, onAck }: { posts: BulletinPost[]; onAck: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(posts[0]?.id ?? null);
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>布告欄</h1>
      <p style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>請先看過以下公告，按「我知道」後才會進入工作分類表。</p>
      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {posts.map((p) => (
          <li key={p.id} style={{ border: '1px solid #e5e2da', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            <button
              onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
            >
              {p.thumbnail_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnail_url} alt={p.title} style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />
              )}
              <div style={{ padding: '10px 14px' }}>
                <span style={{ display: 'block', fontSize: 14, color: '#2C2C2A' }}>{p.title}</span>
              </div>
            </button>
            {expandedId === p.id && (
              <div style={{ padding: '0 14px 14px', fontSize: 13, color: '#444', whiteSpace: 'pre-wrap' }}>{p.content}</div>
            )}
          </li>
        ))}
      </ul>
      <button
        onClick={onAck}
        style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#2C2C2A', color: '#fff', fontSize: 14, cursor: 'pointer' }}
      >
        我知道
      </button>
    </main>
  );
}


// 首頁：登入後依「身分」自動列出能用的入口，沒權限的根本不會出現。
// 「教學作業」預設展開；「行政管理」對有授課的人預設收合（只是畫面整理，不是權限開關，想看隨時點開）。
function HubCard({ hub, count, label, desc, titleLines, tm }: { hub: HubDef; count: number; label: string; desc: string; titleLines: number; tm: TileMetrics }) {
  return (
    <Link
      href={hub.href}
      style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: tm.tileH, padding: 12, overflow: 'hidden', background: '#fff', border: '1px solid #e5e2da', borderRadius: 12, color: '#2C2C2A', textAlign: 'center', alignItems: 'center' }}
    >
      {/* 標題區高度統一（以行數最多的標題為準），所有按鈕的說明才會對齊 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: Math.round(titleLines * tm.titleSize * 1.3), fontSize: tm.titleSize, fontWeight: 700, lineHeight: 1.3 }}>{label}</div>
      {tm.tileH >= 110 + (titleLines - 1) * tm.titleSize && <div style={{ fontSize: tm.descSize, color: '#888', marginTop: 4, lineHeight: 1.35 }}>{desc}</div>}
      {count > 1 && tm.tileH >= 130 && <div style={{ fontSize: tm.descSize - 1, color: '#aaa', marginTop: 6 }}>{count} 個項目</div>}
    </Link>
  );
}

export default function AdminHomePage() {
  const isMobile = useIsMobile();
  const { caps } = useCaps();
  const [siteContent, setSiteContent] = useState<Record<string, string>>({});
  const [bulletinPosts, setBulletinPosts] = useState<BulletinPost[]>([]);
  const [bulletinAcked, setBulletinAcked] = useState(true);
  const [manageOpen, setManageOpen] = useState<boolean | null>(null);
  // 方形按鈕自動大小：按鈕少就大、按鈕多（管理職）就自動縮小，整體約佔畫面高度的 2/3
  const allHubs = caps ? visibleHubs(caps).filter((h) => h.key !== 'clock') : [];
  const tileTotal =
    allHubs.filter((h) => h.group === 'teach').length +
    ((manageOpen ?? !(caps && (caps.teacherLike || caps.club))) ? allHubs.filter((h) => h.group === 'manage').length : 0);
  const tm = useTileMetrics(Math.max(1, tileTotal), 0.62);

  useEffect(() => {
    loadSiteContentCached().then(setSiteContent).catch(() => {});
    getPublishedPosts(10).then((posts) => {
      setBulletinPosts(posts);
      const latest = posts[0]?.published_at ?? null;
      let acked: string | null = null;
      try { acked = localStorage.getItem(BULLETIN_ACK_KEY); } catch {}
      setBulletinAcked(!latest || acked === latest);
    });
  }, []);

  function handleAck() {
    const latest = bulletinPosts[0]?.published_at ?? null;
    try { if (latest) localStorage.setItem(BULLETIN_ACK_KEY, latest); } catch {}
    setBulletinAcked(true);
  }

  if (!caps) return <main style={{ padding: 24, color: '#999' }}>載入中…</main>;
  if (!bulletinAcked && bulletinPosts.length > 0) return <BulletinGate posts={bulletinPosts} onAck={handleAck} />;

  const hubs = visibleHubs(caps);
  // 「教職員打卡」不佔方形按鈕，放到下面「其他」
  const teach = hubs.filter((h) => h.group === 'teach' && h.key !== 'clock');
  const manage = hubs.filter((h) => h.group === 'manage');
  const teaches = caps.teacherLike || caps.club;
  const open = manageOpen ?? !teaches;
  const label = (h: HubDef) => siteContent[hubLabelKey(h.key)] || h.label;
  const descOf = (h: HubDef) => siteContent[hubDescKey(h.key)] ?? h.desc;
  const titleLines = maxTitleLines([...teach, ...(open ? manage : [])].map(label), tm);
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(${tm.cols}, minmax(0, 1fr))`, gap: tm.gap };

  const extras: { id: string; href: string; label: string; show: boolean }[] = [
    { id: 'clock', href: '/clock', label: '教職員打卡', show: hubs.some((h) => h.key === 'clock') },
    { id: 'notifications', href: '/notifications', label: '通知', show: true },
    { id: 'leave', href: '/leave', label: '請假', show: !!caps.ident.teacherId && !caps.ident.acting },
    { id: 'schedule-lookup', href: '/schedule-lookup', label: '課表查詢', show: caps.teacherLike || caps.academic },
    { id: 'proxy', href: '/account/proxy', label: '代理人設定', show: true },
    { id: 'account', href: '/account', label: '帳號設定', show: true },
  ];

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: isMobile ? 16 : 24 }}>
      {caps.ident.acting && (
        <div style={{ background: '#FDECEC', border: '1px solid #F2B8B8', color: '#A32D2D', padding: '8px 12px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          您目前正在代理 <b>{caps.ident.acting.principalName}</b>（到 {new Date(caps.ident.acting.endAt).toLocaleString('zh-TW', { hour12: false })}），可代理對方的一線教學工作（點名、成績、平時表現）；審核與行政權限不包含。右上角可結束代理。
        </div>
      )}
      {caps.preview && (
        <div style={{ background: '#EAF3EC', border: '1px solid #BFE0C6', color: '#3B6D11', padding: '8px 12px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          目前是「預覽教師畫面」，只顯示一般教師看得到的功能。
        </div>
      )}

      {teach.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ color: '#6B5B3A', margin: '0 0 10px' }}>教學作業</h2>
          <div style={grid}>{teach.map((h) => <HubCard key={h.key} hub={h} count={hubVisibleTabs(h, caps).length} label={label(h)} desc={descOf(h)} titleLines={titleLines} tm={tm} />)}</div>
        </section>
      )}

      {manage.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <button
            onClick={() => { const n = !open; setManageOpen(n); try { localStorage.setItem(MANAGE_OPEN_KEY, n ? '1' : '0'); } catch {} }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#3A5470', margin: '0 0 10px', fontWeight: 700 }}
          >
            {open ? '▼' : '▶'} 行政管理（{manage.length}）
          </button>
          {open && <div style={grid}>{manage.map((h) => <HubCard key={h.key} hub={h} count={hubVisibleTabs(h, caps).length} label={label(h)} desc={descOf(h)} titleLines={titleLines} tm={tm} />)}</div>}
        </section>
      )}

      <section>
        <h2 style={{ color: '#888', margin: '0 0 8px' }}>其他</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {extras.filter((e) => e.show).map((e) => (
            <Link key={e.href} href={e.href} style={{ padding: isMobile ? '12px 18px' : '10px 16px', background: '#fff', border: '1px solid #e5e2da', borderRadius: 10, fontSize: isMobile ? 17 : 15, fontWeight: 600, color: '#2C2C2A' }}>{siteContent[extraLabelKey(e.id)] || e.label}</Link>
          ))}
        </div>
      </section>
    </main>
  );
}

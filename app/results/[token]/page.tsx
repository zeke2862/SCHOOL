'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

type Result = { name: string; school: string | null; rank: number | null; award: string | null; total: number | null };
type ViewItem = { group: string; item: string; revision: number; published_at: string | null; results: Result[] };
type Notice = { kind: 'publish' | 'correction' | 'info'; title: string; body: string | null; revision: number | null; created_at: string };
type View = { title: string; items: ViewItem[]; notices: Notice[] };

const fmt = (iso: string) => new Date(iso).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const RANK_COLOR: Record<number, string> = { 1: '#b8860b', 2: '#6b7280', 3: '#a0522d' };

// QR 碼公開成績頁：不需登入，家長與外校掃碼就能看「已公布」的成績和修正公告。
// 只顯示姓名、學校、名次與獎項（承辦人另外開啟才顯示分數），不顯示學號，也看不到尚未公布的項目。
// 現場很多人同時掃碼，所以每 60 秒才自動更新一次，伺服器端另有 20 秒快取。
export default function PublicResultsPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');
  const [q, setQ] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/competition/${token}`);
      if (res.status === 404) return setStatus('notfound');
      if (!res.ok) return setStatus((s) => (s === 'ok' ? s : 'error')); // 已經有資料時，暫時失敗就保留舊畫面
      setView(await res.json());
      setUpdatedAt(new Date());
      setStatus('ok');
    } catch {
      setStatus((s) => (s === 'ok' ? s : 'error'));
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const kw = q.trim().toLowerCase();
  const items = useMemo(() => {
    if (!view) return [];
    if (!kw) return view.items;
    return view.items
      .map((it) => ({ ...it, results: it.results.filter((r) => `${r.name}${r.school ?? ''}`.toLowerCase().includes(kw)) }))
      .filter((it) => it.results.length > 0);
  }, [view, kw]);

  const wrap: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '16px 14px 40px' };

  if (status === 'loading') return <main style={wrap}><p style={{ color: '#888' }}>載入中…</p></main>;
  if (status === 'notfound') {
    return (
      <main style={wrap}>
        <h1 style={{ fontSize: 20 }}>找不到成績頁</h1>
        <p style={{ color: '#555', fontSize: 15, lineHeight: 1.7 }}>這個連結可能已失效，或成績還沒開放查詢。請向承辦單位確認，或重新掃描最新的 QR 碼。</p>
      </main>
    );
  }
  if (status === 'error' || !view) {
    return (
      <main style={wrap}>
        <h1 style={{ fontSize: 20 }}>暫時無法讀取</h1>
        <p style={{ color: '#555', fontSize: 15 }}>網路忙碌，請稍後再試。</p>
        <button onClick={load} style={{ padding: '10px 18px', fontSize: 16 }}>重新整理</button>
      </main>
    );
  }

  const corrections = view.notices.filter((n) => n.kind === 'correction');

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px', lineHeight: 1.35 }}>{view.title}</h1>
      <p style={{ fontSize: 13, color: '#777', margin: '0 0 14px' }}>
        成績查詢{updatedAt ? `・更新於 ${updatedAt.toLocaleTimeString('zh-TW', { hour12: false })}` : ''}
        <button onClick={load} className="keep-size" style={{ marginLeft: 10, padding: '2px 10px', fontSize: 13, minHeight: 0 }}>重新整理</button>
      </p>

      {view.notices.length > 0 && (
        <section aria-label="公告" style={{ marginBottom: 18 }}>
          {view.notices.slice(0, 8).map((n, i) => (
            <div key={i} style={{ background: n.kind === 'correction' ? '#fdecec' : '#fff', border: `1px solid ${n.kind === 'correction' ? '#e8b4b4' : '#e5e5e5'}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: n.kind === 'correction' ? '#A32D2D' : '#222' }}>
                {n.kind === 'correction' ? '⚠ ' : '📢 '}{n.title}
              </div>
              <div style={{ fontSize: 12, color: '#888', margin: '2px 0 4px' }}>{fmt(n.created_at)}</div>
              {n.body && <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', color: '#333', lineHeight: 1.6 }}>{n.body}</div>}
            </div>
          ))}
        </section>
      )}

      {view.items.length === 0 ? (
        <p style={{ fontSize: 16, color: '#555', padding: '24px 0' }}>成績尚未公布，公布後會顯示在這裡。</p>
      ) : (
        <>
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋姓名或學校" aria-label="搜尋姓名或學校"
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 16, border: '1px solid #bbb', borderRadius: 8, marginBottom: 14 }}
          />
          {items.length === 0 && <p style={{ color: '#777', fontSize: 15 }}>找不到「{q}」。可能是該項目還沒公布，或姓名／學校打錯了。</p>}
          {items.map((it, idx) => (
            <section key={idx} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, marginBottom: 14, overflow: 'hidden' }}>
              <h2 style={{ fontSize: 16, margin: 0, padding: '10px 12px', background: '#f3f6fa', borderBottom: '1px solid #e5e5e5' }}>
                {it.group}・{it.item}
                {it.revision > 0 && <span style={{ fontSize: 12, color: '#A32D2D', marginLeft: 8 }}>已修正 {it.revision} 次</span>}
              </h2>
              {it.results.filter((r) => r.rank || r.award).length === 0 ? (
                <p style={{ margin: 0, padding: 12, color: '#777', fontSize: 14 }}>沒有得獎名單。</p>
              ) : (
                <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {it.results.filter((r) => r.rank || r.award).map((r, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i ? '1px solid #f0f0f0' : undefined }}>
                      <span style={{ minWidth: 44, fontWeight: 700, fontSize: 16, color: (r.rank && RANK_COLOR[r.rank]) || '#444' }}>{r.rank ? `第${r.rank}名` : '—'}</span>
                      <span style={{ flex: 1, fontSize: 16 }}>
                        <b>{r.name}</b>
                        {r.school && <span style={{ display: 'block', fontSize: 13, color: '#777' }}>{r.school}</span>}
                      </span>
                      <span style={{ fontSize: 14, color: '#333', textAlign: 'right' }}>
                        {r.award}
                        {r.total !== null && r.total !== undefined && <span style={{ display: 'block', fontSize: 12, color: '#888' }}>{r.total} 分</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
          {corrections.length > 0 && <p style={{ fontSize: 12, color: '#777' }}>本頁成績如有修正，會在上方「公告」說明原因與更動內容。</p>}
        </>
      )}
    </main>
  );
}

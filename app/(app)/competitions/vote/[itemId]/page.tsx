'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { CompItem } from '@/lib/competitionScoring';
import { btn, btnPrimary, errText, fmtTime, hint, useFlash } from '@/components/competition/ui';

type Entry = { id: string; entry_no: number; title: string | null; photo_path: string };
type Vote = { id: string; entry_id: string };

// 作品投票頁（教師）：匿名看作品照片，只顯示編號與標題，投票期間內可投、可收回。
// 每位老師的票只有自己看得到；票數由承辦人在投票結束後統計。
export default function VotePage() {
  const { itemId } = useParams<{ itemId: string }>();
  const flash = useFlash();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');
  const [item, setItem] = useState<CompItem | null>(null);
  const [title, setTitle] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [votes, setVotes] = useState<Vote[]>([]);
  const [busy, setBusy] = useState('');
  const [zoom, setZoom] = useState<Entry | null>(null);

  const load = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return setState('denied');
    const { data: it } = await supabase.from('comp_items').select('*').eq('id', itemId).maybeSingle();
    if (!it || it.score_type !== 'vote') return setState('denied');
    const [ev, en, vt] = await Promise.all([
      supabase.from('comp_events').select('title').eq('id', it.event_id).maybeSingle(),
      supabase.from('comp_entries').select('id, entry_no, title, photo_path').eq('item_id', itemId).order('entry_no'),
      supabase.from('comp_votes').select('id, entry_id').eq('item_id', itemId).eq('voter_user_id', uid),
    ]);
    // 只有本校教職員讀得到作品；讀不到（不是教職員）就當作沒有權限
    if (en.error || !ev.data) return setState('denied');
    const list = (en.data ?? []) as Entry[];
    setItem(it as CompItem);
    setTitle(`${ev.data.title}・${it.name}`);
    setEntries(list);
    setVotes((vt.data ?? []) as Vote[]);
    if (list.length) {
      const { data: signed } = await supabase.storage.from('competition').createSignedUrls(list.map((e) => e.photo_path), 3600);
      const m: Record<string, string> = {};
      (signed ?? []).forEach((u, i) => { if (u.signedUrl) m[list[i].id] = u.signedUrl; });
      setUrls(m);
    }
    setState('ok');
  }, [itemId]);
  useEffect(() => { load(); }, [load]);

  const cfg = item?.config ?? {};
  const openAt = cfg.vote_open_at ? new Date(cfg.vote_open_at).getTime() : null;
  const closeAt = cfg.vote_close_at ? new Date(cfg.vote_close_at).getTime() : null;
  const now = Date.now();
  const phase: 'upcoming' | 'open' | 'closed' = item?.published_at || (closeAt && now > closeAt) ? 'closed' : openAt && now < openAt ? 'upcoming' : 'open';
  const limit = cfg.votes_per_voter ? Number(cfg.votes_per_voter) : null;
  const used = votes.length;
  const remaining = limit === null ? null : Math.max(0, limit - used);

  async function toggle(e: Entry) {
    const mine = votes.find((v) => v.entry_id === e.id);
    setBusy(e.id);
    if (mine) {
      const { data, error } = await supabase.from('comp_votes').delete().eq('id', mine.id).select('id');
      setBusy('');
      if (error) return flash.err(errText(error));
      if (!data?.length) return flash.err('現在不能收回投票（投票時間已過）');
      setVotes((vs) => vs.filter((v) => v.id !== mine.id));
      flash.ok(`已收回對 ${e.entry_no} 號的投票`);
    } else {
      const { data, error } = await supabase.from('comp_votes').insert({ item_id: itemId, entry_id: e.id }).select('id, entry_id').single();
      setBusy('');
      if (error) return flash.err(errText(error));
      setVotes((vs) => [...vs, data as Vote]);
      flash.ok(`已投給 ${e.entry_no} 號`);
    }
  }

  if (state === 'loading') return <main style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}><p style={hint}>載入中…</p></main>;
  if (state === 'denied' || !item) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
        <h1 style={{ fontSize: 16 }}>作品投票</h1>
        <p style={{ ...hint, marginTop: 8 }}>只有本校教職員可以投票，或找不到這個投票項目。</p>
        <Link href="/competitions" style={{ color: '#1f4e79', fontSize: 13 }}>← 回競賽活動</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
      <Link href={`/competitions/${item.event_id}`} style={{ color: '#1f4e79', fontSize: 12 }}>← 回賽事</Link>
      <h1 style={{ fontSize: 16, margin: '4px 0' }}>{title}</h1>
      <p style={{ ...hint, marginBottom: 8 }}>
        {phase === 'upcoming' && `投票尚未開始（${fmtTime(cfg.vote_open_at)} 開放）。`}
        {phase === 'open' && <>投票中{cfg.vote_close_at ? `，${fmtTime(cfg.vote_close_at)} 截止` : ''}。{limit !== null ? <>每位老師可投 {limit} 票，您還剩 <b>{remaining}</b> 票。</> : '票數不限。'}投票期間內可以改投。</>}
        {phase === 'closed' && '投票已結束，結果由承辦人統計後公布。'}
      </p>
      <p style={{ ...hint, marginBottom: 12 }}>為了公平，作品只顯示編號，您的投票其他人看不到。</p>
      {flash.node}

      {entries.length === 0 && <p style={hint}>還沒有上傳作品。</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {entries.map((e) => {
          const voted = votes.some((v) => v.entry_id === e.id);
          const canVote = phase === 'open' && (voted || remaining === null || remaining > 0);
          return (
            <figure key={e.id} style={{ margin: 0, border: voted ? '2px solid #1f4e79' : '1px solid #e5e5e5', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
              <button onClick={() => setZoom(e)} aria-label={`放大 ${e.entry_no} 號作品`} className="keep-size"
                style={{ display: 'block', width: '100%', padding: 0, border: 0, background: '#f3f3f3', cursor: 'zoom-in', minHeight: 0 }}>
                {urls[e.id] ? <img src={urls[e.id]} alt={`${e.entry_no} 號作品${e.title ? '：' + e.title : ''}`} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} /> : <div style={{ height: 200 }} />}
              </button>
              <figcaption style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, fontSize: 14 }}><b>{e.entry_no} 號</b>{e.title ? `　${e.title}` : ''}</div>
                {phase !== 'upcoming' && (
                  <button onClick={() => toggle(e)} disabled={!canVote || busy === e.id} style={voted ? btn : btnPrimary}>
                    {voted ? (phase === 'open' ? '收回投票' : '✓ 已投') : '投給這件'}
                  </button>
                )}
              </figcaption>
            </figure>
          );
        })}
      </div>

      {zoom && (
        <div role="dialog" aria-label="作品大圖" onClick={() => setZoom(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 12 }}>
          {urls[zoom.id] && <img src={urls[zoom.id]} alt={`${zoom.entry_no} 號作品`} style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain' }} />}
          <p style={{ color: '#fff', marginTop: 8 }}>{zoom.entry_no} 號{zoom.title ? `　${zoom.title}` : ''}（點任何地方關閉）</p>
        </div>
      )}
    </main>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  CompEvent, CompGroup, CompItem, CompReg, CompResult, CompScore, Computed, SCORE_TYPE_LABEL, chessPoints, computeRanking, suggestAward,
} from '@/lib/competitionScoring';
import { Section, btn, btnDanger, btnPrimary, errText, fmtTime, hint, smallInput, td, th, useFlash } from './ui';

type Props = { event: CompEvent; groups: CompGroup[]; items: CompItem[]; reload: () => Promise<void> };
type Judge = { user_id: string; name: string };
type Notice = { id: string; kind: string; revision: number | null; title: string; body: string | null; created_at: string };
type Entry = { id: string; entry_no: number; title: string | null; photo_path: string; registration_id: string | null };

export default function ScoresTab({ event, groups, items, reload }: Props) {
  const flash = useFlash();
  const scorable = items.filter((i) => i.id);
  const [itemId, setItemId] = useState(scorable[0]?.id ?? '');
  const item = items.find((i) => i.id === itemId);
  const [regs, setRegs] = useState<CompReg[]>([]);
  const [scores, setScores] = useState<CompScore[]>([]);
  const [results, setResults] = useState<CompResult[]>([]);
  const [judges, setJudges] = useState<Judge[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<Record<string, any>>({}); // 非評審制的輸入暫存：regId -> raw
  const [awards, setAwards] = useState<Record<string, string>>({});
  const [fix, setFix] = useState<Record<string, { total: string; rank: string; award: string }>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!itemId) return;
    const [r, s, res, st, n] = await Promise.all([
      supabase.from('comp_registrations').select('*').eq('item_id', itemId).eq('status', 'registered').order('draw_number').order('created_at'),
      supabase.from('comp_scores').select('*').eq('item_id', itemId),
      supabase.from('comp_results').select('*').eq('item_id', itemId),
      supabase.from('comp_staff').select('user_id, staff_role').eq('item_id', itemId).eq('status', 'assigned').eq('staff_role', 'judge'),
      supabase.from('comp_notices').select('id, kind, revision, title, body, created_at').eq('item_id', itemId).order('created_at', { ascending: false }),
    ]);
    const err = r.error || s.error || res.error || st.error || n.error;
    if (err) flash.err(errText(err));
    setRegs((r.data ?? []) as CompReg[]);
    setScores((s.data ?? []) as CompScore[]);
    setResults((res.data ?? []) as CompResult[]);
    setNotices((n.data ?? []) as Notice[]);
    const ids = (st.data ?? []).map((x: any) => x.user_id);
    const names = ids.length ? await supabase.from('app_users').select('id, name').in('id', ids) : { data: [] as any[] };
    setJudges(ids.map((id: string) => ({ user_id: id, name: (names.data ?? []).find((x: any) => x.id === id)?.name ?? id.slice(0, 6) })));
    setEdit({}); setFix({}); setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);
  useEffect(() => { load(); }, [load]);

  // 作品投票：作品與票數、縮圖
  const loadVote = useCallback(async () => {
    if (!item || item.score_type !== 'vote') { setEntries([]); setVotes({}); return; }
    const { data: en } = await supabase.from('comp_entries').select('id, entry_no, title, photo_path, registration_id').eq('item_id', item.id).order('entry_no');
    const list = (en ?? []) as Entry[];
    setEntries(list);
    const { data: tally } = await supabase.rpc('comp_vote_tally', { p_item: item.id });
    const byEntry = new Map<string, number>((tally ?? []).map((t: any) => [t.entry_id, Number(t.votes)]));
    const v: Record<string, number> = {};
    list.forEach((e) => { if (e.registration_id) v[e.registration_id] = byEntry.get(e.id) ?? 0; });
    setVotes(v);
    if (list.length) {
      const { data: urls } = await supabase.storage.from('competition').createSignedUrls(list.map((e) => e.photo_path), 3600);
      const t: Record<string, string> = {};
      (urls ?? []).forEach((u, i) => { if (u.signedUrl) t[list[i].id] = u.signedUrl; });
      setThumbs(t);
    }
  }, [item]);
  useEffect(() => { loadVote(); }, [loadVote, regs.length]);

  const published = !!item?.published_at;
  const computed: Computed[] = useMemo(() => {
    if (!item) return [];
    // 套用尚未儲存的輸入，讓排名即時預覽
    const merged = scores.map((s) => (!s.judge_user_id && edit[s.registration_id] ? { ...s, raw: edit[s.registration_id], total: null } : s));
    regs.forEach((r) => { if (edit[r.id] && !scores.some((s) => s.registration_id === r.id && !s.judge_user_id)) merged.push({ item_id: item.id, registration_id: r.id, judge_user_id: null, raw: edit[r.id], total: null, submitted: false }); });
    const withTotals = merged.map((s) => (!s.judge_user_id && edit[s.registration_id] ? { ...s, total: item.score_type === 'chess' ? chessPoints(s.raw) : toNum(item.score_type === 'test' ? s.raw.score : s.raw.value) } : s));
    return computeRanking(item, regs, withTotals, item.score_type === 'vote' ? votes : undefined);
  }, [item, regs, scores, edit, votes]);

  const submittedBy = (uid: string) => scores.filter((s) => s.judge_user_id === uid && s.submitted && regs.some((r) => r.id === s.registration_id)).length;
  const missingJudges = judges.filter((j) => submittedBy(j.user_id) < regs.length);
  const canPublish = !!item && !published && regs.length > 0 && (item.score_type !== 'judge' || (judges.length > 0 && missingJudges.length === 0))
    && computed.some((c) => c.total !== null);

  async function saveEntered() {
    if (!item) return;
    const rows = Object.entries(edit);
    if (!rows.length) return flash.err('沒有需要儲存的變更');
    setBusy(true);
    for (const [regId, raw] of rows) {
      const total = item.score_type === 'chess' ? chessPoints(raw) : toNum(item.score_type === 'test' ? raw.score : raw.value);
      const existing = scores.find((s) => s.registration_id === regId && !s.judge_user_id);
      const payload = { raw, total, submitted: true, submitted_at: new Date().toISOString(), proxy: true };
      const { error } = existing?.id
        ? await supabase.from('comp_scores').update(payload).eq('id', existing.id)
        : await supabase.from('comp_scores').insert({ item_id: item.id, registration_id: regId, judge_user_id: null, ...payload });
      if (error) { setBusy(false); return flash.err(errText(error)); }
    }
    setBusy(false);
    flash.ok(`已儲存 ${rows.length} 筆成績`);
    await load();
  }

  async function unlock(j: Judge) {
    if (!item || !confirm(`解鎖「${j.name}」已送出的分數，讓他可以修改？`)) return;
    const { error } = await supabase.rpc('comp_unlock_scores', { p_item: item.id, p_judge: j.user_id });
    if (error) return flash.err(errText(error));
    flash.ok(`已解鎖 ${j.name}`); await load();
  }

  async function publish() {
    if (!item) return;
    const payload = computed.filter((c) => c.total !== null).map((c) => ({ registration_id: c.registration_id, total: c.total, rank: c.rank, award: awards[c.registration_id] ?? suggestAward(c.rank) }));
    const msg = `即將公布「${item.name}」的成績（${payload.length} 位選手）。\n公布後學生與外校 QR 頁都看得到；之後如要更動，必須填寫說明並自動發出修正公告。\n\n確定公布？`;
    if (!confirm(msg)) return;
    setBusy(true);
    const { error } = await supabase.rpc('comp_publish_item', { p_item: item.id, p_results: payload });
    setBusy(false);
    if (error) return flash.err(errText(error));
    flash.ok('已公布成績'); await reload(); await load();
  }

  async function correct() {
    if (!item) return;
    if (reason.trim().length < 2) return flash.err('請填寫修正說明（會顯示在修正公告上）');
    const payload = results.map((r) => {
      const f = fix[r.registration_id];
      return { registration_id: r.registration_id, total: f ? toNum(f.total) : r.total, rank: f ? toNum(f.rank) : r.rank, award: f ? f.award || null : r.award };
    });
    if (!confirm('送出修正後會立刻發出修正公告，並通知相關導師與教師。確定嗎？')) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('comp_correct_item', { p_item: item.id, p_results: payload, p_reason: reason.trim() });
    setBusy(false);
    if (error) return flash.err(errText(error));
    flash.ok(`已發出修正公告（第 ${data} 次修正）`); await reload(); await load();
  }

  // ---- 作品投票的上傳 ----
  async function uploadEntry(file: File) {
    if (!item) return;
    if (!/^image\//.test(file.type)) return flash.err('請選擇圖片檔');
    if (file.size > 8 * 1024 * 1024) return flash.err('圖片太大（上限 8MB）');
    const title = prompt('作品標題（會顯示給投票的老師，請勿寫班級或作者）')?.trim() ?? '';
    const owner = prompt('班級／作者（只在公布成績時顯示，投票期間老師看不到）')?.trim() ?? '';
    const no = (entries.reduce((m, e) => Math.max(m, e.entry_no), 0)) + 1;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${event.id}/${item.id}/${crypto.randomUUID()}.${ext}`;
    setBusy(true);
    const up = await supabase.storage.from('competition').upload(path, file, { contentType: file.type });
    if (up.error) { setBusy(false); return flash.err(errText(up.error)); }
    const reg = await supabase.from('comp_registrations').insert({ event_id: event.id, item_id: item.id, kind: 'external', display_name: title || `作品 ${no}`, school_name: owner || null, draw_number: String(no) }).select('id').single();
    if (reg.error) { await supabase.storage.from('competition').remove([path]); setBusy(false); return flash.err(errText(reg.error)); }
    const en = await supabase.from('comp_entries').insert({ item_id: item.id, entry_no: no, title: title || null, photo_path: path, registration_id: reg.data.id });
    setBusy(false);
    if (en.error) return flash.err(errText(en.error));
    flash.ok(`已上傳作品 ${no} 號`); await load(); await loadVote();
  }
  async function removeEntry(e: Entry) {
    if (!confirm(`刪除作品 ${e.entry_no} 號？已投給它的票會一併消失。`)) return;
    await supabase.from('comp_entries').delete().eq('id', e.id);
    if (e.registration_id) await supabase.from('comp_registrations').delete().eq('id', e.registration_id);
    await supabase.storage.from('competition').remove([e.photo_path]);
    await load(); await loadVote();
  }

  const itemLabel = (i: CompItem) => `${groups.find((g) => g.id === i.group_id)?.name ?? ''}・${i.name}${i.published_at ? '（已公布）' : ''}`;
  const resultOf = (rid: string) => results.find((r) => r.registration_id === rid);

  return (
    <div>
      {flash.node}
      <Section title="選擇項目">
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} style={{ ...smallInput, minWidth: 260 }} aria-label="項目">
          {items.map((i) => <option key={i.id} value={i.id}>{itemLabel(i)}</option>)}
        </select>
        {item && <span style={{ ...hint, marginLeft: 10 }}>{SCORE_TYPE_LABEL[item.score_type]}・{regs.length} 位{item.score_type === 'vote' ? '作品' : '選手'}{published ? `・已公布，修正 ${item.revision} 次` : ''}</span>}
      </Section>

      {item?.score_type === 'vote' && !published && (
        <Section title="作品照片">
          <p style={{ ...hint, marginBottom: 8 }}>上傳作品照片，老師們在投票頁匿名投票（只看到編號與標題）。班級／作者會等到公布成績才顯示。</p>
          <label style={{ ...btnPrimary, display: 'inline-block', cursor: 'pointer' }}>
            ＋ 上傳作品
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadEntry(f); }} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
            {entries.map((e) => (
              <div key={e.id} style={{ border: '1px solid #eee', borderRadius: 6, padding: 6, fontSize: 12 }}>
                {thumbs[e.id] ? <img src={thumbs[e.id]} alt={`作品 ${e.entry_no}`} style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ height: 110, background: '#f5f5f5' }} />}
                <div style={{ marginTop: 4 }}><b>{e.entry_no} 號</b> {e.title} <br /><span style={hint}>目前 {votes[e.registration_id ?? ''] ?? 0} 票</span></div>
                <button onClick={() => removeEntry(e)} style={{ ...btnDanger, marginTop: 4 }}>刪除</button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {item && item.score_type === 'judge' && (
        <Section title="評審送分狀況">
          {judges.length === 0 ? <p style={{ ...hint, color: '#8a5a00' }}>這個項目還沒有分派評審。請到「評審與人員」分派（或建立外聘訪客帳號）。</p> : (
            <table style={{ borderCollapse: 'collapse' }}>
              <thead><tr>{['評審', '已送出', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {judges.map((j) => {
                  const n = submittedBy(j.user_id);
                  return (
                    <tr key={j.user_id}>
                      <td style={td}>{j.name}</td>
                      <td style={{ ...td, color: n >= regs.length && regs.length ? '#2d6a2d' : '#8a5a00' }}>{n} / {regs.length}{n >= regs.length && regs.length ? ' ✓' : ''}</td>
                      <td style={td}>{!published && n > 0 && <button onClick={() => unlock(j)} style={btn}>解鎖讓他修改</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {item && (
        <Section title={published ? '已公布的成績（如需更動請填寫修正說明）' : '成績與名次預覽'}>
          {regs.length === 0 ? <p style={hint}>這個項目沒有選手。</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}>出場</th><th style={th}>選手</th><th style={th}>學校</th>
                    {item.score_type === 'judge' && judges.map((j) => <th key={j.user_id} style={th}>{j.name}</th>)}
                    {!published && ['test', 'chess', 'record'].includes(item.score_type) && <th style={th}>輸入</th>}
                    <th style={th}>總分</th><th style={th}>名次</th><th style={th}>獎項</th>
                  </tr>
                </thead>
                <tbody>
                  {regs.map((r) => {
                    const c = computed.find((x) => x.registration_id === r.id);
                    const res = resultOf(r.id);
                    const e = edit[r.id] ?? scores.find((s) => s.registration_id === r.id && !s.judge_user_id)?.raw ?? {};
                    const f = fix[r.id] ?? { total: res?.total?.toString() ?? '', rank: res?.rank?.toString() ?? '', award: res?.award ?? '' };
                    return (
                      <tr key={r.id}>
                        <td style={td}>{r.draw_number}</td><td style={td}>{r.display_name}</td><td style={td}>{r.school_name}</td>
                        {item.score_type === 'judge' && judges.map((j) => {
                          const s = scores.find((x) => x.registration_id === r.id && x.judge_user_id === j.user_id);
                          return <td key={j.user_id} style={{ ...td, color: s?.submitted ? undefined : '#aaa' }}>{s?.total ?? '—'}{s && !s.submitted ? '（未送出）' : ''}</td>;
                        })}
                        {!published && item.score_type === 'test' && <td style={td}><input type="number" value={e.score ?? ''} onChange={(ev) => setEdit({ ...edit, [r.id]: { score: ev.target.value } })} style={{ ...smallInput, width: 70 }} aria-label="分數" /></td>}
                        {!published && item.score_type === 'record' && <td style={td}><input type="number" step="any" value={e.value ?? ''} onChange={(ev) => setEdit({ ...edit, [r.id]: { value: ev.target.value } })} style={{ ...smallInput, width: 80 }} aria-label="紀錄" /></td>}
                        {!published && item.score_type === 'chess' && (
                          <td style={td}>
                            {(['wins', 'draws', 'losses'] as const).map((k) => (
                              <label key={k} style={{ fontSize: 11, marginRight: 4 }}>{k === 'wins' ? '勝' : k === 'draws' ? '和' : '敗'}
                                <input type="number" min={0} value={e[k] ?? ''} onChange={(ev) => setEdit({ ...edit, [r.id]: { ...e, [k]: ev.target.value } })} style={{ ...smallInput, width: 42, marginLeft: 2 }} />
                              </label>
                            ))}
                          </td>
                        )}
                        {published ? (
                          <>
                            <td style={td}><input value={f.total} onChange={(ev) => setFix({ ...fix, [r.id]: { ...f, total: ev.target.value } })} style={{ ...smallInput, width: 70 }} aria-label="總分" /></td>
                            <td style={td}><input value={f.rank} onChange={(ev) => setFix({ ...fix, [r.id]: { ...f, rank: ev.target.value } })} style={{ ...smallInput, width: 50 }} aria-label="名次" /></td>
                            <td style={td}><input value={f.award} onChange={(ev) => setFix({ ...fix, [r.id]: { ...f, award: ev.target.value } })} style={{ ...smallInput, width: 90 }} aria-label="獎項" /></td>
                          </>
                        ) : (
                          <>
                            <td style={td}>{c?.total ?? '—'}</td><td style={td}>{c?.rank ?? '—'}</td>
                            <td style={td}>{c?.rank ? <input value={awards[r.id] ?? suggestAward(c.rank)} onChange={(ev) => setAwards({ ...awards, [r.id]: ev.target.value })} style={{ ...smallInput, width: 90 }} aria-label="獎項" /> : ''}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!published && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {['test', 'chess', 'record'].includes(item.score_type) && <button onClick={saveEntered} disabled={busy || !Object.keys(edit).length} style={btn}>儲存輸入的成績</button>}
              <button onClick={publish} disabled={busy || !canPublish} style={btnPrimary}>確認並公布成績</button>
              {item.score_type === 'judge' && missingJudges.length > 0 && judges.length > 0 && <span style={{ ...hint, color: '#8a5a00' }}>尚未送完：{missingJudges.map((j) => j.name).join('、')}</span>}
              {!canPublish && item.score_type !== 'judge' && regs.length > 0 && !computed.some((c) => c.total !== null) && <span style={hint}>請先輸入成績</span>}
            </div>
          )}

          {published && (
            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, display: 'block' }}>修正說明（必填，會顯示在修正公告上）
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ width: '100%', padding: 6, marginTop: 4, boxSizing: 'border-box' }} placeholder="例如：第三位評審分數登記錯誤，已更正" />
              </label>
              <button onClick={correct} disabled={busy} style={{ ...btnPrimary, marginTop: 8 }}>送出修正並發出公告</button>
              <p style={{ ...hint, marginTop: 6 }}>只會公告「有改變」的人；沒有任何更動時不會送出。</p>
            </div>
          )}
        </Section>
      )}

      {notices.length > 0 && (
        <Section title="這個項目的公告紀錄">
          {notices.map((n) => (
            <div key={n.id} style={{ borderTop: '1px solid #f0f0f0', padding: '8px 0', fontSize: 13 }}>
              <b>{n.title}</b> <span style={hint}>{fmtTime(n.created_at)}</span>
              {n.body && <div style={{ whiteSpace: 'pre-wrap', color: '#444', marginTop: 4 }}>{n.body}</div>}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

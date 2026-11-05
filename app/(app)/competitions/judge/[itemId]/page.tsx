'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { CompItem, CompReg, CompScore } from '@/lib/competitionScoring';
import { TOTAL_KEY, rawToVals, rowTotal, scoreFields, valsToRaw } from '@/lib/competitionJudge';
import { btn, btnPrimary, errText, hint, useFlash } from '@/components/competition/ui';

type Vals = Record<string, Record<string, string>>; // regId -> fieldKey -> text

// 評審打分頁（手機優先）：每位選手一張卡片，依評分準則逐項輸入，系統自動加總。
// 每格輸入完離開（或按「全部儲存」）就存成草稿；全部選手都打完後按「送出」才會鎖定，
// 鎖定後要由承辦人解鎖才能再改。評審只看得到自己的分數。
export default function JudgeScoringPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const flash = useFlash();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');
  const [item, setItem] = useState<CompItem | null>(null);
  const [title, setTitle] = useState('');
  const [eventStatus, setEventStatus] = useState('');
  const [regs, setRegs] = useState<CompReg[]>([]);
  const [vals, setVals] = useState<Vals>({});
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const rowIds = useRef<Record<string, string>>({}); // regId -> 我的 comp_scores.id
  const uidRef = useRef('');
  // 避免「存檔還在途中又改了分數」的競態：valsRef 永遠是最新輸入；verRef 每次輸入 +1；
  // savedVer 是已成功存進資料庫的版本；chain 讓同一位選手的存檔一個接一個進行。
  const valsRef = useRef<Vals>({});
  const verRef = useRef<Record<string, number>>({});
  const savedVer = useRef<Record<string, number>>({});
  const chain = useRef<Record<string, Promise<boolean>>>({});

  const load = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return setState('denied');
    uidRef.current = uid;
    const { data: it } = await supabase.from('comp_items').select('*').eq('id', itemId).maybeSingle();
    if (!it) return setState('denied');
    const [st, ev, grp, rg, sc] = await Promise.all([
      supabase.from('comp_staff').select('id').eq('item_id', itemId).eq('user_id', uid).eq('status', 'assigned').in('staff_role', ['judge', 'referee']).limit(1),
      supabase.from('comp_events').select('title, status').eq('id', it.event_id).maybeSingle(),
      supabase.from('comp_groups').select('name').eq('id', it.group_id).maybeSingle(),
      supabase.from('comp_registrations').select('*').eq('item_id', itemId).eq('status', 'registered').order('draw_number').order('created_at'),
      supabase.from('comp_scores').select('*').eq('item_id', itemId).eq('judge_user_id', uid),
    ]);
    if (!st.data?.length) return setState('denied');
    const item = it as CompItem;
    setItem(item);
    setTitle(`${ev.data?.title ?? ''}・${grp.data?.name ?? ''}・${item.name}`);
    setEventStatus(ev.data?.status ?? '');
    // 抽籤序號是數字字串，用數字排序（"10" 要排在 "2" 後面）
    const list = ((rg.data ?? []) as CompReg[]).sort((a, b) => (Number(a.draw_number) || 1e9) - (Number(b.draw_number) || 1e9));
    setRegs(list);
    const v: Vals = {};
    rowIds.current = {};
    for (const row of (sc.data ?? []) as (CompScore & { id: string })[]) {
      v[row.registration_id] = rawToVals(row.raw, row.total);
      rowIds.current[row.registration_id] = row.id;
    }
    setVals(v);
    valsRef.current = v;
    verRef.current = {}; savedVer.current = {}; chain.current = {};
    setSubmitted(list.length > 0 && list.every((r) => (sc.data ?? []).some((x: any) => x.registration_id === r.id && x.submitted)));
    setDirty(new Set());
    setState('ok');
  }, [itemId]);
  useEffect(() => { load(); }, [load]);

  const fields = useMemo(() => scoreFields(item?.criteria ?? []), [item]);
  const locked = submitted || !!item?.published_at;

  // 有未儲存的輸入時，關閉分頁前提醒
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty.size) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const totals = useMemo(() => {
    const m: Record<string, { total: number | null; error: string | null }> = {};
    regs.forEach((r) => { m[r.id] = rowTotal(fields, vals[r.id]); });
    return m;
  }, [regs, vals, fields]);

  function setCell(regId: string, key: string, text: string) {
    const next = { ...valsRef.current, [regId]: { ...(valsRef.current[regId] ?? {}), [key]: text } };
    valsRef.current = next;
    verRef.current[regId] = (verRef.current[regId] ?? 0) + 1;
    setVals(next);
    setDirty((d) => new Set(d).add(regId));
  }
  const needsSave = (regId: string) => (verRef.current[regId] ?? 0) > (savedVer.current[regId] ?? 0);

  /** 儲存一位選手的草稿（同一位選手的存檔排隊依序做）。回傳是否成功。 */
  function saveRow(regId: string): Promise<boolean> {
    const prev = chain.current[regId] ?? Promise.resolve(true);
    const p = prev.then(() => doSave(regId));
    chain.current[regId] = p.catch(() => false);
    return p;
  }

  async function doSave(regId: string): Promise<boolean> {
    if (!item) return false;
    if (!needsSave(regId)) return true; // 前一次排隊的存檔已經把最新內容存好了
    const startVer = verRef.current[regId] ?? 0;
    const cur = valsRef.current[regId];
    const { total, error } = rowTotal(fields, cur);
    if (error) { setRowErr((e) => ({ ...e, [regId]: error })); return false; }
    setRowErr((e) => { const n = { ...e }; delete n[regId]; return n; });
    const payload = { raw: valsToRaw(fields, cur ?? {}), total, submitted: false, updated_at: new Date().toISOString() };
    const id = rowIds.current[regId];
    let res = id
      ? await supabase.from('comp_scores').update(payload).eq('id', id).select('id').single()
      : await supabase.from('comp_scores').insert({ item_id: item.id, registration_id: regId, judge_user_id: uidRef.current, ...payload }).select('id').single();
    if (res.error && !id && /duplicate|unique/i.test(res.error.message)) {
      // 另一個分頁剛好先存過了：改成更新那一筆
      const { data: ex } = await supabase.from('comp_scores').select('id').eq('item_id', item.id).eq('registration_id', regId).eq('judge_user_id', uidRef.current).maybeSingle();
      if (ex) res = await supabase.from('comp_scores').update(payload).eq('id', ex.id).select('id').single();
    }
    if (res.error || !res.data) { flash.err('儲存失敗：' + errText(res.error ?? { message: '未知錯誤' })); return false; }
    rowIds.current[regId] = res.data.id;
    savedVer.current[regId] = Math.max(savedVer.current[regId] ?? 0, startVer);
    // 只有「存檔期間沒有再改過」才清掉未儲存標記；改過的話，後面還會再存一次
    if ((verRef.current[regId] ?? 0) === startVer) setDirty((d) => { const n = new Set(d); n.delete(regId); return n; });
    return true;
  }

  async function saveAll(): Promise<boolean> {
    setSaving(true);
    let ok = true;
    for (const r of regs) {
      if (!needsSave(r.id)) continue;
      if (!(await saveRow(r.id))) ok = false;
    }
    setSaving(false);
    if (ok) flash.ok('已儲存');
    return ok;
  }

  const filled = regs.filter((r) => totals[r.id]?.total !== null).length;

  async function submit() {
    if (filled < regs.length) return flash.err(`還有 ${regs.length - filled} 位選手沒有打完，請補完再送出`);
    if (regs.some((r) => totals[r.id]?.error)) return flash.err('有格子的分數不合規定，請先修正');
    if (!(await saveAll())) return;
    if (!confirm(`送出後分數就鎖定了，要修改必須請承辦人解鎖。\n\n確定送出 ${regs.length} 位選手的分數？`)) return;
    setSaving(true);
    const { error } = await supabase.rpc('comp_submit_my_scores', { p_item: itemId });
    setSaving(false);
    if (error) return flash.err(errText(error));
    flash.ok('已送出，謝謝您的評分！');
    await load();
  }

  if (state === 'loading') return <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}><p style={hint}>載入中…</p></main>;
  if (state === 'denied' || !item) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
        <h1 style={{ fontSize: 16 }}>評審打分</h1>
        <p style={{ ...hint, marginTop: 8 }}>你沒有被分派到這個項目，或帳號已到期。如有疑問請洽賽事承辦人。</p>
        <Link href="/competitions" style={{ color: '#1f4e79', fontSize: 13 }}>← 回競賽活動</Link>
      </main>
    );
  }
  if (item.score_type !== 'judge') {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
        <h1 style={{ fontSize: 16 }}>{title}</h1>
        <p style={{ ...hint, marginTop: 8 }}>這個項目不是評審評分制，成績由承辦人輸入。</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16, paddingBottom: 96 }}>
      <Link href="/competitions" style={{ color: '#1f4e79', fontSize: 12 }}>← 競賽活動</Link>
      <h1 style={{ fontSize: 16, margin: '4px 0' }}>{title}</h1>
      <p style={{ ...hint, marginBottom: 8 }}>
        已完成 <b>{filled}</b> / {regs.length} 位。{item.criteria.length ? '請依各項評分準則給分，系統會自動加總。' : '請輸入總分（0–100）。'}
      </p>
      {eventStatus && eventStatus !== 'running' && !locked && (
        <p style={{ fontSize: 12, color: '#8a5a00', background: '#fff7e6', padding: 8, borderRadius: 6, marginBottom: 8 }}>
          這場賽事目前不是「比賽中」狀態，若尚未開始評分請先等承辦人通知。
        </p>
      )}
      {locked && (
        <p style={{ fontSize: 13, color: '#2d6a2d', background: '#eaf5ea', padding: 10, borderRadius: 6, marginBottom: 8 }}>
          {item.published_at ? '成績已公布，不能再修改。' : '你已送出分數並鎖定。如需修改，請洽承辦人解鎖。'}
        </p>
      )}
      {flash.node}

      {regs.length === 0 && <p style={hint}>這個項目目前沒有選手。</p>}
      {regs.map((r) => {
        const t = totals[r.id];
        const isDirty = dirty.has(r.id);
        return (
          <section key={r.id} style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 12, marginBottom: 12, background: locked ? '#fafafa' : '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 20, fontWeight: 700, minWidth: 36 }}>{r.draw_number ? `${r.draw_number} 號` : ''}</span>
              <b style={{ fontSize: 15 }}>{r.display_name}</b>
              <span style={hint}>{[r.school_name, r.grade_label].filter(Boolean).join('・')}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: t?.total !== null ? '#2d6a2d' : '#999' }}>
                {t?.total !== null ? `合計 ${t?.total}` : '未打完'}{isDirty ? '（未儲存）' : ''}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 8 }}>
              {fields.map((f) => (
                <label key={f.key} style={{ fontSize: 12 }}>
                  {f.label}
                  <input
                    inputMode="decimal" disabled={locked} value={vals[r.id]?.[f.key] ?? ''}
                    onChange={(e) => setCell(r.id, f.key, e.target.value)}
                    onBlur={() => { if (needsSave(r.id)) saveRow(r.id); }}
                    placeholder={`0–${f.max}`} aria-label={`${r.display_name} ${f.key === TOTAL_KEY ? '總分' : f.key}`}
                    style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 10, fontSize: 18, border: '1px solid #bbb', borderRadius: 6 }}
                  />
                </label>
              ))}
            </div>
            {(rowErr[r.id] || t?.error) && <p style={{ fontSize: 12, color: '#A32D2D', margin: '6px 0 0' }}>{rowErr[r.id] || t?.error}</p>}
          </section>
        );
      })}

      {!locked && regs.length > 0 && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', borderTop: '1px solid #ddd', padding: 10, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={saveAll} disabled={saving || dirty.size === 0} style={btn}>{dirty.size ? `全部儲存（${dirty.size}）` : '已全部儲存'}</button>
          <button onClick={submit} disabled={saving || filled < regs.length} style={btnPrimary}>送出並鎖定</button>
        </div>
      )}
    </main>
  );
}

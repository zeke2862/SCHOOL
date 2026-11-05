'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { CompEvent, EVENT_STATUS_LABEL, GROUP_PRESETS } from '@/lib/competitionScoring';
import { Section, btnPrimary, card, errText, fmtTime, hint, inputStyle, td, th, useFlash } from '@/components/competition/ui';

// 賽事列表：所有人看得到「已開放」的賽事；承辦人另外看得到自己的草稿，並可建立新賽事。
// 任何教職員都能建立賽事，建立者自動成為承辦人。
export default function CompetitionsPage() {
  const router = useRouter();
  const flash = useFlash();
  const [events, setEvents] = useState<CompEvent[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [isStaff, setIsStaff] = useState(false);
  const [tasks, setTasks] = useState<{ itemId: string; label: string; event: string; done: number; total: number; locked: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [f, setF] = useState({ title: '', scope: 'internal', template: '', presets: true });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    const [ev, org, me] = await Promise.all([
      supabase.from('comp_events').select('*').order('created_at', { ascending: false }),
      uid ? supabase.from('comp_organizers').select('event_id').eq('user_id', uid) : Promise.resolve({ data: [] as any[], error: null }),
      uid ? supabase.from('app_users').select('role').eq('id', uid).maybeSingle() : Promise.resolve({ data: null as any }),
    ]);
    if (ev.error) flash.err(errText(ev.error));
    setEvents((ev.data ?? []) as CompEvent[]);
    setMine(new Set((org.data ?? []).map((o: any) => o.event_id)));
    setIsStaff(!!me.data && me.data.role !== 'competition_guest');

    // 我被分派的評審任務（評審制項目）與目前打分進度
    if (uid) {
      const { data: st } = await supabase.from('comp_staff').select('item_id').eq('user_id', uid).eq('status', 'assigned').eq('staff_role', 'judge').not('item_id', 'is', null);
      const ids = Array.from(new Set((st ?? []).map((x: any) => x.item_id as string)));
      if (ids.length) {
        const [its, regs, sc] = await Promise.all([
          supabase.from('comp_items').select('id, name, event_id, group_id, score_type, published_at').in('id', ids),
          supabase.from('comp_registrations').select('item_id').in('item_id', ids).eq('status', 'registered'),
          supabase.from('comp_scores').select('item_id, total, submitted').in('item_id', ids).eq('judge_user_id', uid),
        ]);
        const evIds = Array.from(new Set((its.data ?? []).map((i: any) => i.event_id)));
        const grpIds = Array.from(new Set((its.data ?? []).map((i: any) => i.group_id)));
        const [evs, grs] = await Promise.all([
          supabase.from('comp_events').select('id, title').in('id', evIds),
          supabase.from('comp_groups').select('id, name').in('id', grpIds),
        ]);
        setTasks((its.data ?? []).filter((i: any) => i.score_type === 'judge').map((i: any) => {
          const mine = (sc.data ?? []).filter((x: any) => x.item_id === i.id);
          return {
            itemId: i.id,
            label: `${grs.data?.find((g: any) => g.id === i.group_id)?.name ?? ''}・${i.name}`,
            event: evs.data?.find((e: any) => e.id === i.event_id)?.title ?? '',
            total: (regs.data ?? []).filter((r: any) => r.item_id === i.id).length,
            done: mine.filter((x: any) => x.total !== null).length,
            locked: !!i.published_at || (mine.length > 0 && mine.every((x: any) => x.submitted)),
          };
        }));
      } else setTasks([]);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!f.title.trim()) return flash.err('請填賽事名稱');
    setBusy(true);
    try {
      const { data: ev, error } = await supabase.from('comp_events').insert({ title: f.title.trim(), scope: f.scope, status: 'draft' }).select('*').single();
      if (error || !ev) throw error ?? new Error('建立失敗');
      if (f.template) {
        // 沿用過去賽事的組別與項目（只複製設定，不複製選手與成績）
        const [g, i] = await Promise.all([
          supabase.from('comp_groups').select('*').eq('event_id', f.template).order('sort_no'),
          supabase.from('comp_items').select('*').eq('event_id', f.template).order('sort_no'),
        ]);
        const map = new Map<string, string>();
        for (const grp of g.data ?? []) {
          const { data: ng, error: e1 } = await supabase.from('comp_groups').insert({
            event_id: ev.id, code: grp.code, name: grp.name, grade_levels: grp.grade_levels, teacher_only: grp.teacher_only, sort_no: grp.sort_no,
          }).select('id').single();
          if (e1 || !ng) throw e1 ?? new Error('複製組別失敗');
          map.set(grp.id, ng.id);
        }
        const rows = (i.data ?? []).filter((it: any) => map.has(it.group_id)).map((it: any) => ({
          event_id: ev.id, group_id: map.get(it.group_id), code: it.code, name: it.name, score_type: it.score_type, judge_count: it.judge_count,
          criteria: it.criteria, quota: it.quota, sort_no: it.sort_no,
          config: Object.fromEntries(Object.entries(it.config ?? {}).filter(([k]) => !['vote_open_at', 'vote_close_at'].includes(k))), // 投票時間要重設
        }));
        if (rows.length) { const { error: e2 } = await supabase.from('comp_items').insert(rows); if (e2) throw e2; }
      } else if (f.presets) {
        const { error: e3 } = await supabase.from('comp_groups').insert(GROUP_PRESETS.map((p, k) => ({
          event_id: ev.id, code: p.code, name: p.name, grade_levels: p.grades, teacher_only: !!p.teacherOnly, sort_no: k + 1,
        })));
        if (e3) throw e3;
      }
      router.push(`/competitions/${ev.id}/manage`);
    } catch (e) {
      flash.err('建立賽事失敗：' + errText(e));
      setBusy(false);
    }
  }

  // 「已結束」的賽事自動收到下方（預設收合）；兩區都依建立時間由新到舊排列
  const byNewest = (x: CompEvent, y: CompEvent) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0);
  const current = events.filter((e) => e.status !== 'finished').sort(byNewest);
  const finished = events.filter((e) => e.status === 'finished').sort(byNewest);

  const renderTable = (list: CompEvent[]) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{['賽事', '狀態', '報名時間', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.id}>
              <td style={td}><b>{e.title}</b>{e.scope === 'external' && <span style={{ ...hint, marginLeft: 6 }}>（含外校）</span>}</td>
              <td style={td}>{EVENT_STATUS_LABEL[e.status]?.split('（')[0]}</td>
              <td style={td}>{e.reg_open_at || e.reg_close_at ? `${fmtTime(e.reg_open_at)} ～ ${fmtTime(e.reg_close_at)}` : '—'}</td>
              <td style={td}><Link href={`/competitions/${e.id}`} style={{ color: 'var(--primary-ink)' }}>{e.status === 'open' ? '報名／詳情 →' : '詳情 →'}</Link>
                {mine.has(e.id) && <> ｜ <Link href={`/competitions/${e.id}/manage`} style={{ color: 'var(--primary-ink)' }}>承辦人管理 →</Link></>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>競賽活動</h1>
      <p style={{ ...hint, marginBottom: 16 }}>
        {isStaff
          ? '任何老師都可以建立賽事，建立的人就是承辦人，可以設定組別項目、分派評審、公布成績。賽事開放後，學生與教師可在這裡報名。'
          : '這裡列出您可以參加或負責的賽事。被分派的評審任務會顯示在「我的評審任務」。'}
      </p>
      {flash.node}

      {tasks.length > 0 && (
        <Section title="我的評審任務">
          {tasks.map((t) => (
            <div key={t.itemId} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <div><b>{t.label}</b><div style={hint}>{t.event}</div></div>
              <span style={{ ...hint, marginLeft: 'auto' }}>{t.locked ? '已送出' : `已打 ${t.done} / ${t.total}`}</span>
              <Link href={`/competitions/judge/${t.itemId}`} style={{ color: 'var(--primary-ink)', fontSize: 14 }}>{t.locked ? '查看 →' : '去打分 →'}</Link>
            </div>
          ))}
        </Section>
      )}

      {isStaff && (
        <Section title="建立新賽事">
          {!showNew ? <button onClick={() => setShowNew(true)} style={btnPrimary}>＋ 建立賽事</button> : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                <label style={{ fontSize: 12 }}>賽事名稱
                  <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} style={inputStyle} placeholder="例如：校內歌唱比賽" />
                </label>
                <label style={{ fontSize: 12 }}>範圍
                  <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} style={inputStyle}>
                    <option value="internal">校內賽事</option>
                    <option value="external">含外校（外校名單匯入、QR 碼查成績）</option>
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>沿用過去賽事的組別與項目
                  <select value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} style={inputStyle}>
                    <option value="">（不沿用）</option>
                    {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                  </select>
                </label>
              </div>
              {!f.template && (
                <label style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
                  <input type="checkbox" checked={f.presets} onChange={(e) => setF({ ...f, presets: e.target.checked })} /> 先帶入常用組別（教師／高中／初中／小學甲乙，可再修改）
                </label>
              )}
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button onClick={create} disabled={busy} style={btnPrimary}>{busy ? '建立中…' : '建立並開始設定'}</button>
                <button onClick={() => setShowNew(false)} style={{ padding: '6px 12px' }}>取消</button>
              </div>
              <p style={{ ...hint, marginTop: 8 }}>新賽事先是「草稿」，只有承辦人看得到；設定好再開放報名。</p>
            </div>
          )}
        </Section>
      )}

      <Section title="進行中的賽事">
        {loading ? <p style={hint}>載入中…</p> : current.length === 0 ? <p style={hint}>目前沒有進行中的賽事。</p> : renderTable(current)}
      </Section>

      {!loading && finished.length > 0 && (
        <details style={{ ...card, padding: 0 }}>
          <summary style={{ cursor: 'pointer', padding: 16, fontSize: 14, fontWeight: 700 }}>
            已結束的賽事（{finished.length}）<span style={{ ...hint, fontWeight: 400, marginLeft: 8 }}>點開查看，越新越上面</span>
          </summary>
          <div style={{ padding: '0 16px 16px' }}>{renderTable(finished)}</div>
        </details>
      )}
    </main>
  );
}

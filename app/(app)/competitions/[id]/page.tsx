'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { CompEvent, CompGroup, CompItem, CompReg, EVENT_STATUS_LABEL } from '@/lib/competitionScoring';
import { Section, btn, btnDanger, btnPrimary, errText, fmtTime, hint, inputStyle, useFlash } from '@/components/competition/ui';

type Who = 'student' | 'teacher' | 'guest' | 'family';
type StaffRow = { id: string; staff_role: 'judge' | 'referee' | 'staff'; item_id: string | null; status: string; prefer_note: string | null };
type ViewItem = { group: string; item: string; revision: number; results: { name: string; school: string | null; rank: number | null; award: string | null; total: number | null }[] };
type ViewNotice = { kind: string; title: string; body: string | null; created_at: string };
const ROLE_LABEL = { judge: '評審', referee: '裁判', staff: '工作人員' } as const;

// 賽事頁（學生、教師）：看賽事說明、依年級自動列出可報名的組別項目、報名/撤回；教師可志願擔任評審；公布後看成績與公告。
export default function CompetitionEventPage() {
  const { id } = useParams<{ id: string }>();
  const flash = useFlash();
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [event, setEvent] = useState<CompEvent | null>(null);
  const [groups, setGroups] = useState<CompGroup[]>([]);
  const [items, setItems] = useState<CompItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [myRegs, setMyRegs] = useState<CompReg[]>([]);
  const [who, setWho] = useState<Who>('family');
  const [grade, setGrade] = useState<string | null>(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [view, setView] = useState<{ items: ViewItem[]; notices: ViewNotice[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [vol, setVol] = useState({ role: 'judge', note: '' });

  const load = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id ?? '';
    const ev = await supabase.from('comp_events').select('*').eq('id', id).maybeSingle();
    if (!ev.data) return setState('missing');
    const [g, i, c, r, gr, me, org, st, v] = await Promise.all([
      supabase.from('comp_groups').select('*').eq('event_id', id).order('sort_no'),
      supabase.from('comp_items').select('*').eq('event_id', id).order('sort_no'),
      supabase.rpc('comp_item_counts', { p_event: id }),
      supabase.from('comp_registrations').select('*').eq('event_id', id).eq('status', 'registered'),
      supabase.rpc('comp_my_grade'),
      supabase.from('app_users').select('role').eq('id', uid).maybeSingle(),
      supabase.from('comp_organizers').select('user_id').eq('event_id', id).eq('user_id', uid).maybeSingle(),
      supabase.from('comp_staff').select('id, staff_role, item_id, status, prefer_note').eq('event_id', id).eq('user_id', uid).neq('source', 'guest'),
      supabase.rpc('comp_event_view', { p_event: id }),
    ]);
    const myGrade = (gr.data as string | null) ?? null;
    const role = me.data?.role as string | undefined;
    setWho(myGrade ? 'student' : role ? (role === 'competition_guest' ? 'guest' : 'teacher') : 'family');
    setGrade(myGrade);
    setEvent(ev.data as CompEvent);
    setGroups((g.data ?? []) as CompGroup[]);
    setItems((i.data ?? []) as CompItem[]);
    setCounts(Object.fromEntries((c.data ?? []).map((x: any) => [x.item_id, Number(x.registered)])));
    // 導師、承辦人也讀得到別人的報名，所以教師只留自己的；學生本來就只讀得到自己的
    setMyRegs(((r.data ?? []) as CompReg[]).filter((x) => (myGrade ? x.kind === 'student' : x.teacher_user_id === uid)));
    setIsOrganizer(!!org.data);
    setStaff((st.data ?? []) as StaffRow[]);
    setView(v.data as any);
    setState('ok');
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const now = Date.now();
  const windowOpen = !!event && event.status === 'open'
    && (!event.reg_open_at || now >= new Date(event.reg_open_at).getTime())
    && (!event.reg_close_at || now <= new Date(event.reg_close_at).getTime());
  const maxPer = event?.config?.max_items_per_person as number | undefined;

  const eligible = useMemo(() => groups.filter((g) => (who === 'student' ? !g.teacher_only && !!grade && g.grade_levels.includes(grade) : who === 'teacher' ? g.teacher_only : false)), [groups, who, grade]);
  const itemLabel = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((it) => m.set(it.id, `${groups.find((g) => g.id === it.group_id)?.name ?? ''}・${it.name}`));
    return m;
  }, [items, groups]);

  async function register(item: CompItem) {
    setBusy(item.id);
    const { error } = await supabase.rpc('comp_register', { p_item: item.id });
    setBusy('');
    if (error) return flash.err(errText(error));
    flash.ok(`已報名「${item.name}」${who === 'student' ? '，導師會收到通知' : ''}`);
    await load();
  }
  async function withdraw(reg: CompReg, name: string) {
    if (!confirm(`確定撤回「${name}」的報名？`)) return;
    setBusy(reg.item_id);
    const { error } = await supabase.rpc('comp_withdraw', { p_reg: reg.id });
    setBusy('');
    if (error) return flash.err(errText(error));
    flash.ok('已撤回報名');
    await load();
  }
  async function volunteer() {
    const { data: s } = await supabase.auth.getSession();
    const { error } = await supabase.from('comp_staff').insert({ event_id: id, user_id: s.session!.user.id, staff_role: vol.role, status: 'volunteered', source: 'volunteer', prefer_note: vol.note.trim() || null });
    if (error) return flash.err(errText(error));
    flash.ok('已登記志願，承辦人會依需要分派項目給您');
    setVol({ role: 'judge', note: '' });
    await load();
  }
  async function cancelVolunteer(row: StaffRow) {
    const { error } = await supabase.from('comp_staff').delete().eq('id', row.id);
    if (error) return flash.err(errText(error));
    await load();
  }

  if (state === 'loading') return <main style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}><p style={hint}>載入中…</p></main>;
  if (state === 'missing' || !event) {
    return (
      <main style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
        <h1 style={{ fontSize: 16 }}>競賽活動</h1>
        <p style={{ ...hint, marginTop: 8 }}>找不到這場賽事，或還沒開放。</p>
        <Link href="/competitions" style={{ color: '#1f4e79', fontSize: 13 }}>← 回競賽活動</Link>
      </main>
    );
  }

  const canVolunteer = who === 'teacher' && event.status !== 'finished' && event.status !== 'draft';
  const myStaff = staff.filter((x) => x.status !== 'declined');

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
      <Link href="/competitions" style={{ color: '#1f4e79', fontSize: 12 }}>← 競賽活動</Link>
      <h1 style={{ fontSize: 16, margin: '4px 0' }}>{event.title}</h1>
      <p style={{ ...hint, marginBottom: 8 }}>
        {EVENT_STATUS_LABEL[event.status]?.split('（')[0]}
        {(event.reg_open_at || event.reg_close_at) && `・報名時間 ${fmtTime(event.reg_open_at)} ～ ${fmtTime(event.reg_close_at)}`}
        {isOrganizer && <> ・ <Link href={`/competitions/${id}/manage`} style={{ color: '#1f4e79' }}>承辦人管理 →</Link></>}
      </p>
      {event.description && <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: 12 }}>{event.description}</p>}
      {flash.node}

      {who === 'family' && <p style={{ fontSize: 13, background: '#f7f7f7', padding: 10, borderRadius: 6, marginBottom: 12 }}>家長帳號不能代替學生報名，請讓學生用自己的帳號登入報名。</p>}
      {who === 'guest' && <p style={{ fontSize: 13, background: '#f7f7f7', padding: 10, borderRadius: 6, marginBottom: 12 }}>您是賽事訪客，請回「競賽活動」首頁，進入「我的評審任務」打分。</p>}

      {(who === 'student' || who === 'teacher') && (
        <Section title={who === 'student' ? `報名（您的年級：${grade}）` : '報名教師組'}>
          {!windowOpen && (
            <p style={{ fontSize: 13, color: '#8a5a00', background: '#fff7e6', padding: 8, borderRadius: 6, marginBottom: 10 }}>
              {event.status === 'draft' ? '尚未開放報名。' : event.status !== 'open' ? '報名已截止。' : event.reg_open_at && now < new Date(event.reg_open_at).getTime() ? `報名尚未開始（${fmtTime(event.reg_open_at)} 開放）。` : '報名已截止。'}
              {myRegs.length > 0 && ' 如需撤回請洽承辦人。'}
            </p>
          )}
          {maxPer && <p style={{ ...hint, marginBottom: 8 }}>每人最多報名 {maxPer} 項，您目前已報 {myRegs.length} 項。</p>}
          {eligible.length === 0 && <p style={hint}>{who === 'student' ? '這場賽事目前沒有適合您年級的組別。如果您認為應該有，請洽承辦老師。' : '這場賽事沒有教師組。'}</p>}
          {eligible.map((g) => (
            <div key={g.id} style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>{g.name}</h3>
              {items.filter((it) => it.group_id === g.id && it.score_type !== 'vote').map((it) => {
                const mine = myRegs.find((r) => r.item_id === it.id);
                const n = counts[it.id] ?? 0;
                const full = !!it.quota && n >= it.quota;
                return (
                  <div key={it.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ flex: '1 1 160px' }}>
                      <b style={{ fontSize: 14 }}>{it.name}</b>
                      <div style={hint}>{it.quota ? `名額 ${n} / ${it.quota}` : `已有 ${n} 人報名`}</div>
                    </div>
                    {mine ? (
                      <>
                        <span style={{ fontSize: 13, color: '#2d6a2d' }}>✓ 已報名{mine.draw_number ? `・出場序號 ${mine.draw_number}` : ''}</span>
                        {windowOpen && <button onClick={() => withdraw(mine, it.name)} disabled={busy === it.id} style={btnDanger}>撤回</button>}
                      </>
                    ) : (
                      <button onClick={() => register(it)} disabled={!windowOpen || full || busy === it.id || (!!maxPer && myRegs.length >= maxPer)} style={btnPrimary}>
                        {full ? '名額已滿' : busy === it.id ? '處理中…' : '報名'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {who === 'student' && eligible.length > 0 && <p style={hint}>報名後導師會收到通知，不需要導師核可。</p>}
        </Section>
      )}

      {who === 'teacher' && items.some((i) => i.score_type === 'vote') && (
        <Section title="作品投票">
          {items.filter((i) => i.score_type === 'vote').map((i) => {
            const c = i.config ?? {};
            const closed = !!i.published_at || (c.vote_close_at && Date.now() > new Date(c.vote_close_at).getTime());
            const upcoming = c.vote_open_at && Date.now() < new Date(c.vote_open_at).getTime();
            return (
              <div key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid #f0f0f0', fontSize: 13 }}>
                <b>{itemLabel.get(i.id)}</b>
                <span style={hint}>{closed ? '投票已結束' : upcoming ? `${fmtTime(c.vote_open_at)} 開始` : c.vote_close_at ? `${fmtTime(c.vote_close_at)} 截止` : '投票中'}</span>
                <Link href={`/competitions/vote/${i.id}`} style={{ marginLeft: 'auto', color: '#1f4e79' }}>{closed ? '查看 →' : '去投票 →'}</Link>
              </div>
            );
          })}
        </Section>
      )}

      {who === 'teacher' && (
        <Section title="擔任評審／裁判／工作人員">
          {myStaff.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid #f0f0f0', fontSize: 13 }}>
              <b>{ROLE_LABEL[r.staff_role]}</b>
              {r.status === 'volunteered' ? <span style={hint}>已登記志願，等待承辦人分派{r.prefer_note ? `（備註：${r.prefer_note}）` : ''}</span>
                : <span>已分派：{r.item_id ? itemLabel.get(r.item_id) : '全場'}</span>}
              {r.status === 'volunteered' && <button onClick={() => cancelVolunteer(r)} style={{ ...btn, marginLeft: 'auto' }}>取消志願</button>}
              {r.status === 'assigned' && r.item_id && r.staff_role === 'judge' && <Link href={`/competitions/judge/${r.item_id}`} style={{ marginLeft: 'auto', color: '#1f4e79' }}>去打分 →</Link>}
            </div>
          ))}
          {canVolunteer ? (
            <div style={{ marginTop: 10 }}>
              <p style={{ ...hint, marginBottom: 6 }}>願意協助的話可以登記志願，承辦人會依需要分派項目。系統會避開利益衝突（自己參賽的項目、自己導生參賽的項目）。</p>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 8, alignItems: 'end' }}>
                <label style={{ fontSize: 12 }}>身分
                  <select value={vol.role} onChange={(e) => setVol({ ...vol, role: e.target.value })} style={inputStyle}>
                    {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>想評的項目或不方便的時段（選填）
                  <input value={vol.note} onChange={(e) => setVol({ ...vol, note: e.target.value })} style={inputStyle} placeholder="例如：想評歌唱，下午有課" />
                </label>
                <button onClick={volunteer} style={btnPrimary}>登記志願</button>
              </div>
            </div>
          ) : (
            myStaff.length === 0 && <p style={hint}>目前不開放登記。</p>
          )}
        </Section>
      )}

      {view && view.notices.length > 0 && (
        <Section title="公告">
          {view.notices.map((n, i) => (
            <div key={i} style={{ borderTop: i ? '1px solid #f0f0f0' : undefined, padding: '8px 0', fontSize: 13 }}>
              <b style={{ color: n.kind === 'correction' ? '#A32D2D' : undefined }}>{n.kind === 'correction' ? '【修正】' : ''}{n.title}</b>
              <span style={{ ...hint, marginLeft: 8 }}>{fmtTime(n.created_at)}</span>
              {n.body && <div style={{ whiteSpace: 'pre-wrap', color: '#444', marginTop: 4 }}>{n.body}</div>}
            </div>
          ))}
        </Section>
      )}

      {view && view.items.length > 0 && (
        <Section title="比賽成績">
          {view.items.map((vi, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>{vi.group}・{vi.item}{vi.revision > 0 && <span style={{ ...hint, marginLeft: 6 }}>（已修正 {vi.revision} 次）</span>}</h3>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                <tbody>
                  {vi.results.filter((r) => r.rank || r.award).map((r, k) => (
                    <tr key={k}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', width: 56 }}>{r.rank ? `第${r.rank}名` : ''}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{r.name}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', color: '#666' }}>{r.school}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{r.award}{r.total !== null && r.total !== undefined ? `（${r.total}）` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Section>
      )}
    </main>
  );
}

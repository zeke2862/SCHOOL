'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { CompEvent, CompGroup, CompItem } from '@/lib/competitionScoring';
import { Section, authFetch, btn, btnDanger, btnPrimary, errText, fmtTime, hint, inputStyle, smallInput, td, th, useFlash } from './ui';

type Props = { event: CompEvent; groups: CompGroup[]; items: CompItem[]; myId: string };
type StaffRow = { id: string; event_id: string; user_id: string; staff_role: 'judge' | 'referee' | 'staff'; item_id: string | null; status: string; source: string; prefer_note: string | null; conflict_override: boolean };
type Person = { id: string; name: string; role: string };
type Guest = { id: string; name: string; homeOrg: string | null; email: string | null; expiresAt: string | null; itemIds: string[] };

const ROLE_LABEL = { judge: '評審', referee: '裁判', staff: '工作人員' } as const;

export default function StaffTab({ event, groups, items, myId }: Props) {
  const flash = useFlash();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [organizers, setOrganizers] = useState<string[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);

  const load = useCallback(async () => {
    const [s, p, o] = await Promise.all([
      supabase.from('comp_staff').select('*').eq('event_id', event.id).order('created_at'),
      supabase.from('app_users').select('id, name, role').order('name'),
      supabase.from('comp_organizers').select('user_id').eq('event_id', event.id),
    ]);
    if (s.error) flash.err(errText(s.error));
    setStaff((s.data ?? []) as StaffRow[]);
    setPeople(((p.data ?? []) as Person[]).filter((x) => x.role !== 'competition_guest'));
    setOrganizers((o.data ?? []).map((x: any) => x.user_id));
    const g = await authFetch(`/api/competitions/${event.id}/guests`);
    if (g.ok) setGuests((await g.json()).items ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);
  useEffect(() => { load(); }, [load]);

  const name = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const itemLabel = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((i) => m.set(i.id, `${groups.find((g) => g.id === i.group_id)?.name ?? ''}・${i.name}`));
    return m;
  }, [items, groups]);

  const volunteers = staff.filter((s) => s.status === 'volunteered');
  const assigned = staff.filter((s) => s.status === 'assigned' && s.source !== 'guest');

  async function assign(row: StaffRow, itemId: string, override = false) {
    const { error } = await supabase.from('comp_staff').update({ item_id: itemId, status: 'assigned', source: 'assigned', conflict_override: override }).eq('id', row.id);
    if (error) {
      if (/利益衝突/.test(error.message) && !override && confirm(`${error.message}\n\n要以「承辦人例外」強制指派嗎？`)) return assign(row, itemId, true);
      return flash.err(errText(error));
    }
    flash.ok('已指派');
    await load();
  }
  async function addDirect(userId: string, itemId: string, role: string, override = false): Promise<void> {
    const { error } = await supabase.from('comp_staff').insert({ event_id: event.id, user_id: userId, staff_role: role, item_id: itemId || null, status: 'assigned', source: 'assigned', conflict_override: override });
    if (error) {
      if (/利益衝突/.test(error.message) && !override && confirm(`${error.message}\n\n要以「承辦人例外」強制指派嗎？`)) return addDirect(userId, itemId, role, true);
      return flash.err(errText(error));
    }
    flash.ok('已加入');
    await load();
  }
  async function remove(row: StaffRow) {
    if (!confirm('確定移除？')) return;
    const { error } = await supabase.from('comp_staff').delete().eq('id', row.id);
    if (error) return flash.err(errText(error));
    await load();
  }
  async function addOrganizer(userId: string) {
    const { error } = await supabase.from('comp_organizers').insert({ event_id: event.id, user_id: userId });
    if (error) return flash.err(errText(error));
    await load();
  }
  async function removeOrganizer(userId: string) {
    if (organizers.length <= 1) return flash.err('至少要保留一位承辦人');
    if (!confirm(`移除承辦人「${name.get(userId)}」？${userId === myId ? '\n你移除自己之後就無法再管理這場賽事。' : ''}`)) return;
    const { error } = await supabase.from('comp_organizers').delete().eq('event_id', event.id).eq('user_id', userId);
    if (error) return flash.err(errText(error));
    await load();
  }

  return (
    <div>
      {flash.node}
      <VolunteerBox volunteers={volunteers} items={items} name={name} itemLabel={itemLabel} assign={assign} remove={remove} />
      <DirectAddBox people={people} items={items} itemLabel={itemLabel} add={addDirect} />
      <Section title="已分派的評審／裁判／工作人員（校內教師）">
        <p style={{ ...hint, marginBottom: 8 }}>系統會自動擋下利益衝突：本人有報名同一項目，或項目裡有他的導生。需要例外時，指派時會詢問是否強制。</p>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>{['老師', '身分', '負責項目', '備註', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {assigned.map((s) => (
              <tr key={s.id}>
                <td style={td}>{name.get(s.user_id) ?? s.user_id.slice(0, 6)}</td>
                <td style={td}>{ROLE_LABEL[s.staff_role]}</td>
                <td style={td}>{s.item_id ? itemLabel.get(s.item_id) : '（全場）'}</td>
                <td style={td}>{s.conflict_override ? '利益衝突例外' : ''}</td>
                <td style={td}><button onClick={() => remove(s)} style={btnDanger}>移除</button></td>
              </tr>
            ))}
            {assigned.length === 0 && <tr><td colSpan={5} style={{ ...td, color: 'var(--sub)' }}>尚未分派。</td></tr>}
          </tbody>
        </table>
      </Section>
      <GuestBox event={event} items={items} itemLabel={itemLabel} guests={guests} reload={load} flash={flash} />
      <Section title="承辦人">
        <p style={{ ...hint, marginBottom: 8 }}>承辦人可以設定賽事、分派評審、公布與修正成績。共同承辦的老師請在這裡加入。</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {organizers.map((id) => (
            <span key={id} style={{ border: '1px solid var(--line-strong)', borderRadius: 14, padding: '2px 10px', fontSize: 13 }}>
              {name.get(id) ?? id.slice(0, 6)} <button onClick={() => removeOrganizer(id)} style={{ border: 0, background: 'none', cursor: 'pointer', color: '#A32D2D' }} aria-label="移除承辦人">×</button>
            </span>
          ))}
        </div>
        <select defaultValue="" onChange={(e) => { if (e.target.value) { addOrganizer(e.target.value); e.target.value = ''; } }} style={{ ...smallInput, width: 220 }}>
          <option value="">＋ 加入共同承辦人…</option>
          {people.filter((p) => !organizers.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Section>
    </div>
  );
}

function VolunteerBox({ volunteers, items, name, itemLabel, assign, remove }: {
  volunteers: StaffRow[]; items: CompItem[]; name: Map<string, string>; itemLabel: Map<string, string>;
  assign: (r: StaffRow, itemId: string) => Promise<void>; remove: (r: StaffRow) => Promise<void>;
}) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const judgeable = items.filter((i) => i.score_type !== 'vote');
  return (
    <Section title={`教師志願擔任評審／裁判（${volunteers.length} 人）`}>
      {volunteers.length === 0 ? <p style={hint}>目前沒有人志願。老師可以在賽事頁面自己登記志願。</p> : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>{['老師', '身分', '志願備註', '指派到項目', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {volunteers.map((v) => (
              <tr key={v.id}>
                <td style={td}>{name.get(v.user_id) ?? v.user_id.slice(0, 6)}</td>
                <td style={td}>{ROLE_LABEL[v.staff_role]}</td>
                <td style={td}>{v.prefer_note}</td>
                <td style={td}>
                  <select value={pick[v.id] ?? ''} onChange={(e) => setPick({ ...pick, [v.id]: e.target.value })} style={smallInput}>
                    <option value="">選擇項目…</option>
                    {judgeable.map((i) => <option key={i.id} value={i.id}>{itemLabel.get(i.id)}</option>)}
                  </select>
                  <button disabled={!pick[v.id]} onClick={() => assign(v, pick[v.id])} style={{ ...btnPrimary, marginLeft: 6 }}>指派</button>
                </td>
                <td style={td}><button onClick={() => remove(v)} style={btnDanger}>婉拒</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function DirectAddBox({ people, items, itemLabel, add }: { people: Person[]; items: CompItem[]; itemLabel: Map<string, string>; add: (u: string, i: string, r: string) => Promise<void> }) {
  const [u, setU] = useState(''); const [i, setI] = useState(''); const [r, setR] = useState('judge');
  return (
    <Section title="直接指定老師擔任">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={u} onChange={(e) => setU(e.target.value)} style={{ ...smallInput, width: 180 }}>
          <option value="">選擇老師…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={r} onChange={(e) => setR(e.target.value)} style={smallInput}>
          {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={i} onChange={(e) => setI(e.target.value)} style={{ ...smallInput, width: 220 }}>
          <option value="">（全場，不指定項目）</option>
          {items.filter((x) => x.score_type !== 'vote').map((x) => <option key={x.id} value={x.id}>{itemLabel.get(x.id)}</option>)}
        </select>
        <button disabled={!u} onClick={async () => { await add(u, i, r); setU(''); }} style={btnPrimary}>加入</button>
      </div>
    </Section>
  );
}

function GuestBox({ event, items, itemLabel, guests, reload, flash }: {
  event: CompEvent; items: CompItem[]; itemLabel: Map<string, string>; guests: Guest[]; reload: () => Promise<void>; flash: ReturnType<typeof useFlash>;
}) {
  const [f, setF] = useState({ name: '', email: '', homeOrg: '', expiresOn: '', password: '' });
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const judgeable = items.filter((i) => i.score_type !== 'vote');

  async function create() {
    if (!f.name.trim() || !f.email.trim() || !f.expiresOn) return flash.err('請填姓名、信箱和帳號到期日');
    setBusy(true);
    const res = await authFetch(`/api/competitions/${event.id}/guests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...f, password: f.password || undefined, itemIds: sel }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return flash.err(String(j.error ?? '建立失敗').replace(/^ALREADY_STAFF：/, ''));
    flash.ok(j.created ? '已建立訪客帳號' + (f.password ? '（首次登入須改密碼，請把帳號密碼交給對方）' : '，邀請信已寄出') : '這位訪客已有帳號，已加入本賽事');
    setF({ name: '', email: '', homeOrg: '', expiresOn: '', password: '' }); setSel([]);
    await reload();
  }
  async function patch(id: string, body: object, okMsg: string) {
    const res = await authFetch(`/api/competitions/${event.id}/guests`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id, ...body }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return flash.err(j.error ?? '失敗');
    flash.ok(okMsg); await reload();
  }
  async function del(id: string, n: string) {
    if (!confirm(`把「${n}」從這場賽事移除？若他沒有參與其他賽事，帳號會一併停用。`)) return;
    const res = await authFetch(`/api/competitions/${event.id}/guests?userId=${id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return flash.err(j.error ?? '失敗');
    flash.ok(j.accountDisabled ? '已移除並停用帳號' : '已移除'); await reload();
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Section title="外聘評審／裁判（賽事訪客帳號）">
      <p style={{ ...hint, marginBottom: 10 }}>訪客帳號只能使用賽事功能（看得到被分派的項目、打自己的分數），看不到學生、成績、出缺勤等其他校務資料。帳號最長 60 天，到期自動失效。</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <label style={{ fontSize: 12 }}>姓名<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 12 }}>信箱（登入帳號）<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 12 }}>單位（選填）<input value={f.homeOrg} onChange={(e) => setF({ ...f, homeOrg: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 12 }}>帳號到期日<input type="date" min={today} value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} style={inputStyle} /></label>
        <label style={{ fontSize: 12 }}>臨時密碼（空白＝寄邀請信）<input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} style={inputStyle} autoComplete="off" /></label>
      </div>
      <div style={{ marginTop: 10, fontSize: 12 }}>
        負責項目（可複選）：
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {judgeable.map((i) => (
            <label key={i.id} style={{ border: '1px solid var(--line-strong)', borderRadius: 12, padding: '2px 8px', background: sel.includes(i.id) ? '#e8f0fa' : 'var(--surface)' }}>
              <input type="checkbox" checked={sel.includes(i.id)} onChange={(e) => setSel(e.target.checked ? [...sel, i.id] : sel.filter((x) => x !== i.id))} /> {itemLabel.get(i.id)}
            </label>
          ))}
        </div>
      </div>
      <button onClick={create} disabled={busy} style={{ ...btnPrimary, marginTop: 10 }}>{busy ? '建立中…' : '建立訪客帳號'}</button>

      {guests.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 16 }}>
          <thead><tr>{['姓名', '信箱', '單位', '到期', '負責項目', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {guests.map((g) => {
              const expired = g.expiresAt ? new Date(g.expiresAt) <= new Date() : false;
              return (
                <tr key={g.id}>
                  <td style={td}>{g.name}</td>
                  <td style={td}>{g.email}</td>
                  <td style={td}>{g.homeOrg}</td>
                  <td style={{ ...td, color: expired ? '#A32D2D' : undefined }}>{expired ? '已到期 ' : ''}{fmtTime(g.expiresAt)}</td>
                  <td style={td}>{g.itemIds.length ? g.itemIds.map((i) => itemLabel.get(i)).join('、') : '（尚未指定）'}</td>
                  <td style={td}>
                    <button onClick={() => { const d = prompt('延長到期日（YYYY-MM-DD）', today); if (d) patch(g.id, { expiresOn: d }, '已延長'); }} style={btn}>延長</button>{' '}
                    <button onClick={() => { if (confirm(`立即停用「${g.name}」？`)) patch(g.id, { expiresOn: 'now' }, '已停用'); }} style={btn}>停用</button>{' '}
                    <button onClick={() => del(g.id, g.name)} style={btnDanger}>移除</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import {
  CompEvent, CompGroup, CompItem, EVENT_STATUS_LABEL, EVENT_STATUS_ORDER, GRADE_CHOICES, GROUP_PRESETS,
  SCORE_TYPE_LABEL, ScoreType, criteriaToText, parseCriteria,
} from '@/lib/competitionScoring';
import { Section, btn, btnDanger, btnPrimary, errText, fromLocalInput, hint, inputStyle, smallInput, toLocalInput, useFlash } from './ui';

type Props = { event: CompEvent; groups: CompGroup[]; items: CompItem[]; reload: () => Promise<void> };

export default function SetupTab({ event, groups, items, reload }: Props) {
  const flash = useFlash();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [f, setF] = useState({
    title: event.title,
    description: event.description ?? '',
    scope: event.scope,
    reg_open_at: toLocalInput(event.reg_open_at),
    reg_close_at: toLocalInput(event.reg_close_at),
    max_items: event.config?.max_items_per_person ? String(event.config.max_items_per_person) : '',
  });
  const [busy, setBusy] = useState(false);

  async function saveEvent() {
    if (!f.title.trim()) return flash.err('請填賽事名稱');
    const open = fromLocalInput(f.reg_open_at), close = fromLocalInput(f.reg_close_at);
    if (open && close && close <= open) return flash.err('報名截止時間必須晚於開始時間');
    setBusy(true);
    const config = { ...event.config };
    if (f.max_items.trim()) config.max_items_per_person = Math.max(1, Number(f.max_items) || 1);
    else delete config.max_items_per_person;
    const { error } = await supabase.from('comp_events').update({
      title: f.title.trim(), description: f.description.trim() || null, scope: f.scope, reg_open_at: open, reg_close_at: close, config,
    }).eq('id', event.id);
    setBusy(false);
    if (error) return flash.err(errText(error));
    flash.ok('已儲存賽事資料');
    await reload();
  }

  async function setStatus(status: string) {
    if (status === 'open' && (groups.length === 0 || items.length === 0)) return flash.err('請先建立至少一個組別和一個項目，再開放報名');
    if (status === 'open' && !confirm('開放報名後，學生與教師就能在報名頁看到這場賽事。確定嗎？')) return;
    const { error } = await supabase.from('comp_events').update({ status }).eq('id', event.id);
    if (error) return flash.err(errText(error));
    flash.ok(`狀態已改為「${EVENT_STATUS_LABEL[status]}」`);
    await reload();
  }

  async function addPresets() {
    const have = new Set(groups.map((g) => g.code));
    const rows = GROUP_PRESETS.filter((p) => !have.has(p.code)).map((p, i) => ({
      event_id: event.id, code: p.code, name: p.name, grade_levels: p.grades, teacher_only: !!p.teacherOnly, sort_no: groups.length + i + 1,
    }));
    if (!rows.length) return flash.err('常用組別都已經建立了');
    const { error } = await supabase.from('comp_groups').insert(rows);
    if (error) return flash.err(errText(error));
    flash.ok(`已加入 ${rows.length} 個組別，可再調整各組的年級`);
    await reload();
  }

  async function addGroup() {
    const code = prompt('組別代碼（英文或數字，例如 F）')?.trim().toUpperCase();
    if (!code) return;
    const name = prompt('組別名稱（例如 親子組）')?.trim();
    if (!name) return;
    const { error } = await supabase.from('comp_groups').insert({ event_id: event.id, code, name, grade_levels: [], teacher_only: false, sort_no: groups.length + 1 });
    if (error) return flash.err(errText(error));
    await reload();
  }

  /** 刪除整場賽事（連同組別、項目、報名、分數、成績、公告、作品投票一起刪，無法復原）。
   *  沒有任何報名/成績的草稿：確認一次即可；有資料的：必須輸入賽事名稱才能刪。 */
  async function deleteEvent() {
    setDeleting(true);
    try {
      const itemIds = items.map((i) => i.id);
      const [regs, staff] = await Promise.all([
        supabase.from('comp_registrations').select('id', { count: 'exact', head: true }).eq('event_id', event.id),
        supabase.from('comp_staff').select('id', { count: 'exact', head: true }).eq('event_id', event.id),
      ]);
      const regCount = regs.count ?? 0;
      const staffCount = staff.count ?? 0;
      const published = items.filter((i) => i.published_at).length;
      const risky = regCount > 0 || published > 0;
      const summary = `「${event.title}」目前有：${regCount} 筆報名/作品、${published} 個項目已公布成績、${staffCount} 筆評審/人員分派。`;
      if (!risky) {
        if (!confirm(`${summary}

確定刪除這場賽事？（無法復原）`)) return;
      } else {
        const typed = prompt(`${summary}

刪除會一併移除所有報名、分數、成績與公告，${published > 0 ? 'QR 公開頁和已公布的成績也會消失，' : ''}無法復原。

如果只是辦完了，建議改成「已結束」就好（會自動收到列表下方）。

確定要刪除，請輸入賽事名稱：
${event.title}`);
        if (typed === null) return;
        if (typed.trim() !== event.title.trim()) return flash.err('輸入的名稱不一致，沒有刪除。');
      }
      // 作品投票的照片檔案（盡力清除；不是自己上傳的檔案沒有權限刪除，會留在儲存桶但沒有任何連結指向它）
      if (itemIds.length) {
        const { data: ents } = await supabase.from('comp_entries').select('photo_path').in('item_id', itemIds);
        const paths = (ents ?? []).map((e: any) => e.photo_path).filter(Boolean);
        if (paths.length) await supabase.storage.from('competition').remove(paths);
      }
      const { data, error } = await supabase.from('comp_events').delete().eq('id', event.id).select('id');
      if (error) return flash.err('刪除失敗：' + errText(error));
      if (!data?.length) return flash.err('沒有刪除任何資料（可能沒有權限，只有承辦人可以刪除）。');
      router.push('/competitions');
    } finally {
      setDeleting(false);
    }
  }

  const nextIdx = EVENT_STATUS_ORDER.indexOf(event.status as any);

  return (
    <div>
      {flash.node}
      <Section title="賽事資料">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <label style={{ fontSize: 12 }}>賽事名稱
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>範圍
            <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as any })} style={inputStyle}>
              <option value="internal">校內賽事</option>
              <option value="external">含外校（外校名單由承辦人匯入、成績用 QR 碼查詢）</option>
            </select>
          </label>
          <label style={{ fontSize: 12 }}>報名開始（空白＝開放後立即可報）
            <input type="datetime-local" value={f.reg_open_at} onChange={(e) => setF({ ...f, reg_open_at: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>報名截止（空白＝不限時間）
            <input type="datetime-local" value={f.reg_close_at} onChange={(e) => setF({ ...f, reg_close_at: e.target.value })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12 }}>每人最多報幾項（空白＝不限）
            <input type="number" min={1} value={f.max_items} onChange={(e) => setF({ ...f, max_items: e.target.value })} style={inputStyle} />
          </label>
        </div>
        <label style={{ fontSize: 12, display: 'block', marginTop: 12 }}>說明（學生與教師報名時看得到）
          <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} style={inputStyle} />
        </label>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={saveEvent} disabled={busy} style={btnPrimary}>儲存</button>
          <span style={hint}>目前狀態：<b>{EVENT_STATUS_LABEL[event.status]}</b></span>
        </div>
      </Section>

      <Section title="賽事進度">
        <p style={{ ...hint, marginBottom: 8 }}>草稿階段只有承辦人看得到；改成「開放報名」學生與教師才看得到並能報名。可以往前也可以往回調整。</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {EVENT_STATUS_ORDER.map((s, i) => (
            <button key={s} onClick={() => s !== event.status && setStatus(s)} disabled={s === event.status}
              style={{ ...btn, ...(s === event.status ? { background: '#1f4e79', color: '#fff', borderColor: '#1f4e79' } : {}), ...(i === nextIdx + 1 ? { borderColor: '#1f4e79' } : {}) }}>
              {EVENT_STATUS_LABEL[s].split('（')[0]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="組別與項目" id="groups">
        <p style={{ ...hint, marginBottom: 8 }}>
          學生依「目前就讀班級的年級」自動歸組，只能報名自己年級所屬的組別。教師組不開放學生報名。年級沒有被任何組別涵蓋的學生就報不了名，請確認每個年級都有歸屬。
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={addPresets} style={btn}>帶入常用組別（教師／高中／初中／小學甲乙）</button>
          <button onClick={addGroup} style={btn}>＋ 自訂組別</button>
        </div>
        {groups.length === 0 && <p style={hint}>還沒有組別。</p>}
        {groups.map((g) => (
          <GroupBox key={g.id} event={event} group={g} items={items.filter((i) => i.group_id === g.id)} groups={groups} reload={reload} flash={flash} />
        ))}
        <CoverageCheck groups={groups} />
      </Section>

      <Section title="結束或刪除這場賽事">
        <p style={{ ...hint, marginBottom: 8 }}>
          <b>辦完了：</b>把上面「賽事進度」改成「已結束」就好，這場賽事會自動收到賽事列表下方的「已結束的賽事」（預設收合），成績與 QR 公開頁仍然保留。
        </p>
        <p style={{ ...hint, marginBottom: 10 }}>
          <b>建錯了：</b>可以直接刪除。刪除會一併移除組別、項目、報名、分數、成績、公告與作品照片，<b>無法復原</b>。外聘訪客的帳號不會被刪，會留在帳號上直到到期（可到「③ 評審與人員」先停用）。
        </p>
        <button onClick={deleteEvent} disabled={deleting} style={btnDanger}>{deleting ? '處理中…' : '刪除這場賽事'}</button>
      </Section>
    </div>
  );
}

function CoverageCheck({ groups }: { groups: CompGroup[] }) {
  const studentGroups = groups.filter((g) => !g.teacher_only);
  if (!studentGroups.length) return null;
  const covered = new Map<string, string[]>();
  studentGroups.forEach((g) => g.grade_levels.forEach((l) => covered.set(l, [...(covered.get(l) ?? []), g.name])));
  const dup = Array.from(covered.entries()).filter(([, v]) => v.length > 1);
  const missing = GRADE_CHOICES.filter((g) => !covered.has(g) && !['幼甲', '幼乙'].includes(g));
  if (!dup.length && !missing.length) return <p style={{ ...hint, color: '#2d6a2d' }}>✓ 小學～高中各年級都有對應組別，沒有重疊。</p>;
  return (
    <div style={{ fontSize: 12, color: '#8a5a00', background: '#fff7e6', padding: 8, borderRadius: 6 }}>
      {missing.length > 0 && <div>沒有歸屬組別的年級（這些年級的學生報不了名）：{missing.join('、')}</div>}
      {dup.length > 0 && <div>同一年級在多個組別（學生可自行選擇其中一組）：{dup.map(([k, v]) => `${k}→${v.join('/')}`).join('；')}</div>}
    </div>
  );
}

function GroupBox({ event, group, items, groups, reload, flash }: { event: CompEvent; group: CompGroup; items: CompItem[]; groups: CompGroup[]; reload: () => Promise<void>; flash: ReturnType<typeof useFlash> }) {
  const [name, setName] = useState(group.name);
  const [grades, setGrades] = useState<string[]>(group.grade_levels);
  const [teacherOnly, setTeacherOnly] = useState(group.teacher_only);

  async function save() {
    const { error } = await supabase.from('comp_groups').update({ name: name.trim(), grade_levels: teacherOnly ? [] : grades, teacher_only: teacherOnly }).eq('id', group.id);
    if (error) return flash.err(errText(error));
    flash.ok(`已儲存「${name}」`);
    await reload();
  }
  async function remove() {
    const { count } = await supabase.from('comp_registrations').select('id', { count: 'exact', head: true }).in('item_id', items.map((i) => i.id).concat('00000000-0000-0000-0000-000000000000'));
    if (count) return flash.err(`「${group.name}」底下已有 ${count} 筆報名，不能刪除。請先到「報名名單」處理。`);
    if (!confirm(`確定刪除組別「${group.name}」和它的 ${items.length} 個項目？`)) return;
    const { error } = await supabase.from('comp_groups').delete().eq('id', group.id);
    if (error) return flash.err(errText(error));
    await reload();
  }
  async function addItem() {
    const label = prompt('項目名稱（例如 歌唱、硬筆書法、教室布置）')?.trim();
    if (!label) return;
    const type = /布置|繪畫|美術|作品/.test(label) ? 'vote' : /測驗|填空|選選看/.test(label) ? 'test' : /象棋|辯論/.test(label) ? 'chess' : 'judge';
    const n = items.length + 1;
    const { error } = await supabase.from('comp_items').insert({
      event_id: event.id, group_id: group.id, code: `${group.code}${n}`, name: label, score_type: type, judge_count: 3, sort_no: groups.length * 100 + n,
    });
    if (error) return flash.err(errText(error));
    await reload();
  }
  const dirty = name !== group.name || teacherOnly !== group.teacher_only || grades.join() !== group.grade_levels.join();

  return (
    <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>{group.code}</b>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...smallInput, width: 160 }} aria-label="組別名稱" />
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={teacherOnly} onChange={(e) => setTeacherOnly(e.target.checked)} /> 教師組</label>
        {dirty && <button onClick={save} style={btnPrimary}>儲存組別</button>}
        <button onClick={remove} style={{ ...btnDanger, marginLeft: 'auto' }}>刪除組別</button>
      </div>
      {!teacherOnly && (
        <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {GRADE_CHOICES.map((g) => (
            <label key={g} style={{ fontSize: 12, border: '1px solid #ddd', borderRadius: 12, padding: '2px 8px', background: grades.includes(g) ? '#e8f0fa' : '#fff' }}>
              <input type="checkbox" checked={grades.includes(g)} onChange={(e) => setGrades(e.target.checked ? [...grades, g] : grades.filter((x) => x !== g))} /> {g}
            </label>
          ))}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        {items.map((it) => <ItemRow key={it.id} item={it} reload={reload} flash={flash} />)}
        <button onClick={addItem} style={{ ...btn, marginTop: 6 }}>＋ 新增項目</button>
      </div>
    </div>
  );
}

function ItemRow({ item, reload, flash }: { item: CompItem; reload: () => Promise<void>; flash: ReturnType<typeof useFlash> }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: item.name, code: item.code, type: item.score_type as ScoreType, quota: item.quota ? String(item.quota) : '',
    judge_count: String(item.judge_count), criteria: criteriaToText(item.criteria ?? []),
    drop: !!item.config?.drop_high_low, order: (item.config?.record_order as string) ?? 'desc',
    vote_open: toLocalInput(item.config?.vote_open_at), vote_close: toLocalInput(item.config?.vote_close_at), votes: item.config?.votes_per_voter ? String(item.config.votes_per_voter) : '',
  });
  const locked = !!item.published_at;

  async function save() {
    const config: Record<string, any> = { ...item.config };
    delete config.drop_high_low; delete config.record_order; delete config.vote_open_at; delete config.vote_close_at; delete config.votes_per_voter;
    if (f.type === 'judge' && f.drop) config.drop_high_low = true;
    if (f.type === 'record') config.record_order = f.order;
    if (f.type === 'vote') {
      const o = fromLocalInput(f.vote_open), c = fromLocalInput(f.vote_close);
      if (o) config.vote_open_at = o;
      if (c) config.vote_close_at = c;
      if (f.votes.trim()) config.votes_per_voter = Math.max(1, Number(f.votes) || 1);
    }
    const { error } = await supabase.from('comp_items').update({
      name: f.name.trim(), code: f.code.trim().toUpperCase(), score_type: f.type, quota: f.quota.trim() ? Math.max(1, Number(f.quota)) : null,
      judge_count: Math.min(9, Math.max(1, Number(f.judge_count) || 3)), criteria: parseCriteria(f.criteria), config,
    }).eq('id', item.id);
    if (error) return flash.err(errText(error));
    flash.ok(`已儲存「${f.name}」`);
    setOpen(false);
    await reload();
  }
  async function remove() {
    const { count } = await supabase.from('comp_registrations').select('id', { count: 'exact', head: true }).eq('item_id', item.id);
    if (count) return flash.err(`「${item.name}」已有 ${count} 筆報名/作品，不能刪除。`);
    if (!confirm(`確定刪除項目「${item.name}」？`)) return;
    const { error } = await supabase.from('comp_items').delete().eq('id', item.id);
    if (error) return flash.err(errText(error));
    await reload();
  }

  return (
    <div style={{ borderTop: '1px solid #f0f0f0', padding: '6px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ color: '#888', width: 36 }}>{item.code}</span>
        <b>{item.name}</b>
        <span style={hint}>{SCORE_TYPE_LABEL[item.score_type]}{item.quota ? `・限 ${item.quota} 人` : ''}</span>
        {locked && <span style={{ ...hint, color: '#2d6a2d' }}>已公布</span>}
        <button onClick={() => setOpen(!open)} style={{ ...btn, marginLeft: 'auto' }}>{open ? '收合' : '設定'}</button>
      </div>
      {open && (
        <div style={{ background: '#fafafa', padding: 10, borderRadius: 6, marginTop: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <label style={{ fontSize: 12 }}>項目名稱<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={inputStyle} /></label>
            <label style={{ fontSize: 12 }}>項目代碼（匯入名單用）<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} style={inputStyle} /></label>
            <label style={{ fontSize: 12 }}>計分方式
              <select value={f.type} disabled={locked} onChange={(e) => setF({ ...f, type: e.target.value as ScoreType })} style={inputStyle}>
                {(Object.keys(SCORE_TYPE_LABEL) as ScoreType[]).map((k) => <option key={k} value={k}>{SCORE_TYPE_LABEL[k]}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>人數上限（空白＝不限）<input type="number" min={1} value={f.quota} onChange={(e) => setF({ ...f, quota: e.target.value })} style={inputStyle} /></label>
            {f.type === 'judge' && <label style={{ fontSize: 12 }}>預計評審人數<input type="number" min={1} max={9} value={f.judge_count} onChange={(e) => setF({ ...f, judge_count: e.target.value })} style={inputStyle} /></label>}
          </div>
          {f.type === 'judge' && (
            <>
              <label style={{ fontSize: 12, display: 'block', marginTop: 10 }}>評分準則（一行一項，格式「名稱|配分」，例：音準|40%）
                <textarea value={f.criteria} onChange={(e) => setF({ ...f, criteria: e.target.value })} rows={4} style={inputStyle} />
              </label>
              <label style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                <input type="checkbox" checked={f.drop} onChange={(e) => setF({ ...f, drop: e.target.checked })} /> 評審 3 位以上時，去掉一個最高分和一個最低分再加總
              </label>
            </>
          )}
          {f.type === 'record' && (
            <label style={{ fontSize: 12, display: 'block', marginTop: 10 }}>名次排序
              <select value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} style={inputStyle}>
                <option value="desc">數字越大越好（距離、分數）</option>
                <option value="asc">數字越小越好（秒數）</option>
              </select>
            </label>
          )}
          {f.type === 'vote' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
              <label style={{ fontSize: 12 }}>投票開始<input type="datetime-local" value={f.vote_open} onChange={(e) => setF({ ...f, vote_open: e.target.value })} style={inputStyle} /></label>
              <label style={{ fontSize: 12 }}>投票截止<input type="datetime-local" value={f.vote_close} onChange={(e) => setF({ ...f, vote_close: e.target.value })} style={inputStyle} /></label>
              <label style={{ fontSize: 12 }}>每位教師可投幾票（空白＝不限）<input type="number" min={1} value={f.votes} onChange={(e) => setF({ ...f, votes: e.target.value })} style={inputStyle} /></label>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={save} style={btnPrimary}>儲存項目</button>
            <button onClick={remove} style={btnDanger}>刪除項目</button>
          </div>
        </div>
      )}
    </div>
  );
}

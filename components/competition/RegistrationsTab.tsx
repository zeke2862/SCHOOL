'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { CompEvent, CompGroup, CompItem, CompReg } from '@/lib/competitionScoring';
import { Section, btn, btnDanger, btnPrimary, errText, hint, smallInput, td, th, useFlash } from './ui';

type Props = { event: CompEvent; groups: CompGroup[]; items: CompItem[] };

const KIND_LABEL: Record<string, string> = { student: '學生', teacher: '教師', external: '外校/外部' };

export default function RegistrationsTab({ event, groups, items }: Props) {
  const flash = useFlash();
  const [regs, setRegs] = useState<CompReg[]>([]);
  const [itemId, setItemId] = useState('');
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // 預設一次最多回 1000 筆；賽事報名通常遠小於此，若超過這裡分頁讀完
    const all: CompReg[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('comp_registrations').select('*').eq('event_id', event.id).order('created_at').range(from, from + 999);
      if (error) { flash.err(errText(error)); break; }
      all.push(...((data ?? []) as CompReg[]));
      if ((data ?? []).length < 1000) break;
    }
    setRegs(all);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);
  useEffect(() => { load(); }, [load]);

  const itemInfo = useMemo(() => {
    const m = new Map<string, { label: string; group: CompGroup | undefined }>();
    items.forEach((i) => { const g = groups.find((x) => x.id === i.group_id); m.set(i.id, { label: `${g?.name ?? ''}・${i.name}`, group: g }); });
    return m;
  }, [items, groups]);

  const shown = regs.filter((r) => (showWithdrawn || r.status === 'registered') && (!itemId || r.item_id === itemId)
    && (!q.trim() || `${r.display_name}${r.school_name ?? ''}${r.student_no ?? ''}`.includes(q.trim())));
  const active = regs.filter((r) => r.status === 'registered');

  async function withdraw(r: CompReg) {
    if (!confirm(`確定撤回「${r.display_name}」的報名？${r.student_no ? '導師會收到通知。' : ''}`)) return;
    const { error } = await supabase.rpc('comp_withdraw', { p_reg: r.id });
    if (error) return flash.err(errText(error));
    flash.ok('已撤回');
    await load();
  }
  async function saveDraw(r: CompReg, v: string) {
    if ((r.draw_number ?? '') === v.trim()) return;
    const { error } = await supabase.from('comp_registrations').update({ draw_number: v.trim() || null }).eq('id', r.id);
    if (error) return flash.err(errText(error));
    setRegs((rs) => rs.map((x) => (x.id === r.id ? { ...x, draw_number: v.trim() || null } : x)));
  }
  async function drawLots() {
    if (!itemId) return flash.err('請先在上方選一個項目，再抽籤');
    const list = active.filter((r) => r.item_id === itemId);
    if (!list.length) return flash.err('這個項目還沒有人報名');
    if (list.some((r) => r.draw_number) && !confirm('這個項目已有出場序號，重新抽籤會全部覆蓋。確定嗎？')) return;
    const order = [...list];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let i = 0; i < order.length; i += 20) {
      const res = await Promise.all(order.slice(i, i + 20).map((r, k) => supabase.from('comp_registrations').update({ draw_number: String(i + k + 1) }).eq('id', r.id)));
      const bad = res.find((x) => x.error);
      if (bad?.error) return flash.err(errText(bad.error));
    }
    flash.ok(`已為 ${order.length} 位選手抽出場序號`);
    await load();
  }
  async function addExternal() {
    if (!itemId) return flash.err('請先在上方選一個項目');
    const name = prompt('姓名')?.trim(); if (!name) return;
    const school = prompt('學校')?.trim(); if (!school) return;
    const grade = prompt('年級（可留白）')?.trim() || null;
    const { error } = await supabase.from('comp_registrations').insert({ event_id: event.id, item_id: itemId, kind: 'external', display_name: name, school_name: school, grade_label: grade });
    if (error) return flash.err(errText(error));
    await load();
  }
  function exportCsv() {
    const rows = [['組別・項目', '類別', '姓名', '學校', '年級', '學號', '飲食', '出場序號', '狀態']];
    shown.forEach((r) => rows.push([itemInfo.get(r.item_id)?.label ?? '', KIND_LABEL[r.kind], r.display_name, r.school_name ?? '', r.grade_label ?? '', r.student_no ?? '', r.diet ?? '', r.draw_number ?? '', r.status === 'registered' ? '報名中' : '已撤回']));
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${event.title}-報名名單.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const perItem = items.filter((i) => i.score_type !== 'vote').map((i) => ({ i, n: active.filter((r) => r.item_id === i.id).length }));

  return (
    <div>
      {flash.node}
      <Section title="各項目報名人數">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {perItem.map(({ i, n }) => (
            <button key={i.id} onClick={() => setItemId(itemId === i.id ? '' : i.id)}
              style={{ ...btn, ...(itemId === i.id ? { background: '#e8f0fa', borderColor: 'var(--primary)' } : {}) }}>
              {itemInfo.get(i.id)?.label}：<b>{n}</b>{i.quota ? ` / ${i.quota}` : ''}
            </button>
          ))}
          {perItem.length === 0 && <span style={hint}>還沒有項目。</span>}
        </div>
        <p style={{ ...hint, marginTop: 8 }}>共 {active.length} 筆有效報名（其中學生 {active.filter((r) => r.kind === 'student').length}、教師 {active.filter((r) => r.kind === 'teacher').length}、外校 {active.filter((r) => r.kind === 'external').length}）。點項目可篩選。</p>
      </Section>

      <Section title="報名名單">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <input placeholder="搜尋姓名／學校／學號" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...smallInput, width: 200 }} />
          <label style={{ fontSize: 12 }}><input type="checkbox" checked={showWithdrawn} onChange={(e) => setShowWithdrawn(e.target.checked)} /> 顯示已撤回</label>
          <button onClick={drawLots} style={btn}>抽出場序號（需先選項目）</button>
          <button onClick={addExternal} style={btn}>＋ 新增外部選手</button>
          <button onClick={exportCsv} style={btnPrimary}>匯出 CSV</button>
        </div>
        {loading ? <p style={hint}>載入中…</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>{['組別・項目', '類別', '姓名', '學校', '年級', '學號', '飲食', '出場序號', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} style={{ opacity: r.status === 'withdrawn' ? 0.5 : 1 }}>
                    <td style={td}>{itemInfo.get(r.item_id)?.label}</td>
                    <td style={td}>{KIND_LABEL[r.kind]}</td>
                    <td style={td}>{r.display_name}</td>
                    <td style={td}>{r.school_name}</td>
                    <td style={td}>{r.grade_label}</td>
                    <td style={td}>{r.student_no}</td>
                    <td style={td}>{r.diet}</td>
                    <td style={td}>
                      {r.status === 'registered'
                        ? <input defaultValue={r.draw_number ?? ''} onBlur={(e) => saveDraw(r, e.target.value)} style={{ ...smallInput, width: 56 }} aria-label="出場序號" />
                        : '—'}
                    </td>
                    <td style={td}>{r.status === 'registered' ? <button onClick={() => withdraw(r)} style={btnDanger}>撤回</button> : '已撤回'}</td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={9} style={{ ...td, color: 'var(--sub)' }}>沒有符合的報名資料。</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ClockShift, ClockSpecialPeriod } from '@/lib/staffClock';
import { ExamWeek, loadExamWeeks, loadSpecialPeriods } from '@/lib/staffClockData';
import { btn, btnPrimary, input, td, th } from './ClockParts';

type Props = { shifts: ClockShift[] };
type Draft = Omit<ClockSpecialPeriod, 'id'>;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');
const emptyForm: Draft = { name: '', kind: 'fixed', date_from: null, date_to: null, shift_ids: [], start_time: null, end_time: '19:00', active: true, note: null };

// 特殊時段：某段日期（開學前後、考試週…）改用不同的上下班時間。只改時間、不改上班日。
// 「考試週」不用填日期：自動抓成績收件時段（全校）期中考／期末考的開放日當第一天，算一週。
export default function ClockSpecialPeriods({ shifts }: Props) {
  const [rows, setRows] = useState<ClockSpecialPeriod[]>([]);
  const [exams, setExams] = useState<ExamWeek[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [form, setForm] = useState<Draft>(emptyForm);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [sp, ex] = await Promise.all([loadSpecialPeriods(), loadExamWeeks()]);
    setRows(sp);
    setExams(ex);
  }
  useEffect(() => {
    load();
  }, []);

  const activeShifts = shifts.filter((s) => s.active);
  const cur = (r: ClockSpecialPeriod): Draft => drafts[r.id] ?? r;
  const patch = (r: ClockSpecialPeriod, p: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [r.id]: { ...cur(r), ...p } }));

  function check(d: Draft): string | null {
    if (!d.name.trim()) return '請輸入名稱';
    if (d.kind === 'fixed' && (!d.date_from || !d.date_to)) return '請填起訖日期';
    if (d.kind === 'fixed' && d.date_from! > d.date_to!) return '結束日期不能早於開始日期';
    if (!d.start_time && !d.end_time) return '請至少填上班或下班時間其中一個（空白＝維持原班別時間）';
    return null;
  }
  const payload = (d: Draft) => ({
    name: d.name.trim(),
    kind: d.kind,
    date_from: d.kind === 'fixed' ? d.date_from : null,
    date_to: d.kind === 'fixed' ? d.date_to : null,
    shift_ids: d.shift_ids,
    start_time: d.start_time || null,
    end_time: d.end_time || null,
    active: d.active,
    note: d.note?.trim() || null,
  });

  async function save(r: ClockSpecialPeriod) {
    const d = cur(r);
    const err = check(d);
    if (err) return setMessage(err);
    const { error } = await supabase.from('clock_special_periods').update(payload(d)).eq('id', r.id);
    if (error) return setMessage('儲存失敗：' + error.message);
    setMessage(`已儲存「${d.name.trim()}」`);
    setDrafts((p) => {
      const n = { ...p };
      delete n[r.id];
      return n;
    });
    load();
  }

  async function add() {
    const err = check(form);
    if (err) return setMessage(err);
    const { error } = await supabase.from('clock_special_periods').insert(payload(form));
    if (error) return setMessage('新增失敗：' + error.message);
    setMessage(`已新增「${form.name.trim()}」`);
    setForm(emptyForm);
    load();
  }

  async function remove(r: ClockSpecialPeriod) {
    const { error } = await supabase.from('clock_special_periods').delete().eq('id', r.id);
    if (error) return setMessage('刪除失敗：' + error.message);
    setMessage(`已刪除「${r.name}」`);
    load();
  }

  // 用一般函式呼叫（不是元件），避免每次重繪時輸入框被重建而失去焦點
  const shiftChecks = (ids: string[], onChange: (ids: string[]) => void) => (
    <span>
      {activeShifts.map((s) => (
        <label key={s.id} style={{ display: 'block', whiteSpace: 'nowrap', fontSize: 12 }}>
          <input type="checkbox" checked={ids.includes(s.id)} onChange={(e) => onChange(e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))} /> {s.name}
        </label>
      ))}
      {ids.length === 0 && <span style={{ fontSize: 11, color: '#888' }}>（都不勾＝所有班別）</span>}
    </span>
  );

  const fields = (d: Draft, set: (p: Partial<Draft>) => void) => (
    <>
      <td style={td}>
        <input value={d.name} onChange={(e) => set({ name: e.target.value })} style={{ ...input, width: 120 }} placeholder="名稱" />
      </td>
      <td style={td}>
        <select value={d.kind} onChange={(e) => set({ kind: e.target.value as Draft['kind'] })} style={input}>
          <option value="fixed">固定日期</option>
          <option value="exam_week">考試週（自動）</option>
        </select>
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        {d.kind === 'fixed' ? (
          <>
            <input type="date" value={d.date_from ?? ''} onChange={(e) => set({ date_from: e.target.value || null })} style={input} />
            <span style={{ margin: '0 4px' }}>～</span>
            <input type="date" value={d.date_to ?? ''} onChange={(e) => set({ date_to: e.target.value || null })} style={input} />
          </>
        ) : (
          <span style={{ fontSize: 12, color: '#666' }}>依成績收件時段，各算一週</span>
        )}
      </td>
      <td style={td}>
        {shiftChecks(d.shift_ids, (ids) => set({ shift_ids: ids }))}
      </td>
      <td style={td}>
        <input type="time" value={hhmm(d.start_time)} onChange={(e) => set({ start_time: e.target.value || null })} style={input} />
      </td>
      <td style={td}>
        <input type="time" value={hhmm(d.end_time)} onChange={(e) => set({ end_time: e.target.value || null })} style={input} />
      </td>
      <td style={td}>
        <input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} />
      </td>
      <td style={td}>
        <input value={d.note ?? ''} onChange={(e) => set({ note: e.target.value })} style={{ ...input, width: 160 }} />
      </td>
    </>
  );

  return (
    <div>
      <h3 style={{ fontSize: 15, marginTop: 28 }}>特殊時段（開學前後、考試週…）</h3>
      <p style={{ fontSize: 12, color: '#777', marginTop: 0 }}>
        期間內「本來就有排班」的人，改用這裡的上班／下班時間判斷遲到早退（空白＝維持原班別時間）。只改時間，不改哪幾天要上班。
        適用班別都不勾＝所有班別都改（例如週六早班不想被改，就只勾平日晚班）。特殊時段內的日子不會被自動判定成放假。
      </p>
      {message && <p style={{ fontSize: 13, color: message.includes('失敗') || message.includes('請') || message.includes('不能') ? '#c00' : '#2e7d32' }}>{message}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              {['名稱', '類型', '日期', '適用班別', '上班', '下班', '啟用', '備註', ''].map((h) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = cur(r);
              const isDirty = !!drafts[r.id];
              return (
                <tr key={r.id} style={{ background: isDirty ? '#fffdf0' : undefined, opacity: d.active ? 1 : 0.55 }}>
                  {fields(d, (p) => patch(r, p))}
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button style={isDirty ? btnPrimary : btn} disabled={!isDirty} onClick={() => save(r)}>
                      儲存
                    </button>{' '}
                    <button style={btn} onClick={() => remove(r)}>
                      刪除
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr style={{ background: '#fafafa' }}>
              {fields(form, (p) => setForm((f) => ({ ...f, ...p })))}
              <td style={td}>
                <button style={btnPrimary} onClick={add}>
                  新增
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
        考試週日期來源（成績收件時段・全校的期中考／期末考開放日）：
        {exams.length === 0
          ? '目前沒有填開放日期，所以還不會產生考試週。請在設定成績收件時段時，把開放日設成考試第一天。'
          : exams.map((e) => `${e.academic_year}${e.term}${e.exam} ${e.from.slice(5).replace('-', '/')}～${e.to.slice(5).replace('-', '/')}`).join('；')}
      </p>
    </div>
  );
}

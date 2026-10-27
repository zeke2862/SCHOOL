'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// 請假＋順便選代課老師。
//   mode='self'  ：一般教師替「自己」請假（老師固定是自己）。
//   mode='proxy' ：教務處臨時接到請假通知，替別的老師輸入（可以選任何老師）。
// 一次請假可以跨好幾天；每一天列出這位老師當天的課，勾選要請假的節次，
// 每一節旁邊直接列出「那一節真的沒課的老師」可以選代課；不選也可以送出，狀態會是「待安排」，由教務處之後補。
// 寫入的欄位與權限規則見 sql/110_leave_and_substitute.sql。

export type TeacherOption = { id: string; name: string };

type PeriodRow = {
  key: string; // date|period
  date: string;
  weekday: number;
  class_id: string;
  period_no: number;
  subject: string;
  classLabel: string;
  selected: boolean;
  substituteId: string;
};
type DayBlock = { date: string; weekday: number; periods: PeriodRow[] };

const WEEKDAY_LABEL = ['', '一', '二', '三', '四', '五', '六', '日'];
const LEAVE_TYPES = ['事假', '病假', '公假', '公出', '喪假', '婚假', '產假／陪產假', '其他'];

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function weekdayOf(dateStr: string) {
  const js = new Date(dateStr + 'T00:00:00').getDay();
  return js === 0 ? 7 : js;
}
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(to + 'T00:00:00');
  for (let d = new Date(from + 'T00:00:00'); d <= end && out.length < 31; d.setDate(d.getDate() + 1)) out.push(ymd(d));
  return out;
}

export default function LeaveForm(props: {
  mode: 'self' | 'proxy';
  userId: string;
  term: { academic_year: number; term: string } | null;
  teachers: TeacherOption[]; // proxy：可選的老師；self：只放自己一位
  fixedTeacherId?: string;
  onDone?: () => void;
}) {
  const { mode, userId, term, teachers, fixedTeacherId, onDone } = props;
  const [teacherId, setTeacherId] = useState(fixedTeacherId ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [leaveType, setLeaveType] = useState('事假');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<DayBlock[]>([]);
  const [options, setOptions] = useState<Record<string, TeacherOption[] | 'loading'>>({});
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAllFor, setShowAllFor] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (fixedTeacherId) setTeacherId(fixedTeacherId);
  }, [fixedTeacherId]);

  const today = ymd(new Date());

  // 老師或日期變動 → 重新讀這位老師每一天的課
  useEffect(() => {
    setDays([]);
    setOptions({});
    setNote('');
    if (!teacherId || !from || !term) return;
    const end = to && to >= from ? to : from;
    const dates = datesBetween(from, end).filter((d) => weekdayOf(d) <= 6);
    (async () => {
      setLoading(true);
      const blocks: DayBlock[] = [];
      for (const date of dates) {
        const weekday = weekdayOf(date);
        const { data, error } = await supabase
          .from('class_schedule')
          .select('class_id, period_no, subject, classes(grade_level, class_name)')
          .eq('teacher_id', teacherId)
          .eq('academic_year', term.academic_year)
          .eq('term', term.term)
          .eq('weekday', weekday)
          .order('period_no');
        if (error) {
          setNote('讀取課表失敗：' + error.message);
          setLoading(false);
          return;
        }
        const periods: PeriodRow[] = (data ?? []).map((r: any) => ({
          key: `${date}|${r.period_no}`,
          date,
          weekday,
          class_id: r.class_id,
          period_no: r.period_no,
          subject: r.subject,
          classLabel: r.classes ? `${r.classes.grade_level}${r.classes.class_name}` : '',
          selected: true,
          substituteId: '',
        }));
        if (periods.length) blocks.push({ date, weekday, periods });
      }
      setDays(blocks);
      setLoading(false);
      if (!blocks.length) setNote(`這段期間（${from}${end !== from ? ' ～ ' + end : ''}）查不到這位老師有排課，請確認「學校課表」是否已排好這學期的課。`);
      // 一次把每一節的空堂老師查好
      blocks.forEach((b) => b.periods.forEach((p) => loadOptions(p)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId, from, to, term?.academic_year, term?.term]);

  async function loadOptions(p: PeriodRow) {
    if (!term) return;
    setOptions((prev) => ({ ...prev, [p.key]: 'loading' }));
    const { data, error } = await supabase.rpc('available_substitute_teachers', {
      p_academic_year: term.academic_year,
      p_term: term.term,
      p_weekday: p.weekday,
      p_period_no: p.period_no,
      p_date: p.date,
    });
    const list = error ? [] : (data ?? []).map((r: any) => ({ id: r.teacher_id, name: r.teacher_name })).filter((t: TeacherOption) => t.id !== teacherId);
    setOptions((prev) => ({ ...prev, [p.key]: list }));
  }

  function patch(key: string, change: Partial<PeriodRow>) {
    setDays((prev) => prev.map((d) => ({ ...d, periods: d.periods.map((p) => (p.key === key ? { ...p, ...change } : p)) })));
  }

  const chosen = useMemo(() => days.flatMap((d) => d.periods).filter((p) => p.selected), [days]);
  const teacherName = teachers.find((t) => t.id === teacherId)?.name ?? '';

  async function submit() {
    if (!term) return alert('讀不到目前的學年學期，請稍後再試');
    if (!teacherId) return alert('請先選擇請假的老師');
    if (!chosen.length) return alert('請至少勾選一節要請假的課');
    if (mode === 'self' && from < today) return alert('請假日期不能早於今天；已經過去的日期請洽教務處代為輸入');
    // 同一位代課老師不能同一天同一節被選兩次（這個表單裡只會是同一人的課，所以不會發生；保險檢查）
    const group = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined;
    const rows = chosen.map((p) => ({
      academic_year: term.academic_year,
      term: term.term,
      class_id: p.class_id,
      weekday: p.weekday,
      period_no: p.period_no,
      subject: p.subject,
      original_teacher_id: teacherId,
      substitute_teacher_id: p.substituteId || null,
      substitute_date: p.date,
      reason: reason.trim() || null,
      leave_type: leaveType,
      leave_group: group,
      requested_by: userId,
      created_by: userId,
      entered_by_academic: mode === 'proxy',
      status: p.substituteId ? '已排定' : '待安排',
    }));
    const noSub = rows.filter((r) => !r.substitute_teacher_id).length;
    const msg =
      `${mode === 'proxy' ? teacherName + ' ' : ''}共請假 ${rows.length} 節` +
      (noSub ? `，其中 ${noSub} 節還沒選代課老師（會先列為「待安排」，由教務處之後安排）` : '，每一節都已指定代課老師') +
      '。確定送出嗎？';
    if (!confirm(msg)) return;
    setBusy(true);
    const { error } = await supabase.from('substitute_assignments').insert(rows);
    setBusy(false);
    if (error) {
      const dup = /uq_substitute_active_slot|duplicate key/i.test(error.message);
      alert(dup ? '其中有幾節已經登記過請假／代課了（同一班同一天同一節只能登記一次），請到下方清單查看，必要時先取消再重新登記。' : '送出失敗：' + error.message);
      return;
    }
    alert('已送出。系統會發站內通知給請假老師與代課老師。');
    setDays([]);
    setOptions({});
    setFrom('');
    setTo('');
    setReason('');
    if (mode === 'proxy') setTeacherId('');
    onDone?.();
  }

  const box: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12, background: '#fafafa' };

  return (
    <div>
      {mode === 'proxy' && (
        <label style={{ display: 'block', fontSize: 13, marginBottom: 10 }}>
          請假的老師
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} style={{ display: 'block', padding: 6, marginTop: 4, minWidth: 220 }}>
            <option value="">— 選擇老師 —</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ fontSize: 13 }}>
          請假起日
          <input type="date" value={from} min={mode === 'self' ? today : undefined} onChange={(e) => { setFrom(e.target.value); if (to && e.target.value > to) setTo(''); }} style={{ display: 'block', padding: 6, marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 13 }}>
          迄日（單日請假可不填）
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={{ display: 'block', padding: 6, marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 13 }}>
          假別
          <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} style={{ display: 'block', padding: 6, marginTop: 4 }}>
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 13, flex: 1, minWidth: 200 }}>
          事由（選填）
          <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ display: 'block', padding: 6, marginTop: 4, width: '100%' }} />
        </label>
      </div>

      {loading && <p style={{ fontSize: 12, color: '#2C6E9E' }}>讀取課表與空堂老師中…</p>}
      {note && <p style={{ fontSize: 12, color: '#A36A00' }}>{note}</p>}

      {days.map((d) => (
        <div key={d.date} style={box}>
          <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 8 }}>
            {d.date}（星期{WEEKDAY_LABEL[d.weekday]}）
          </div>
          {d.periods.map((p) => {
            const opt = options[p.key];
            const showAll = showAllFor[p.key];
            return (
              <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '4px 0', borderTop: '1px dashed #e5e5e5' }}>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, minWidth: 220 }}>
                  <input type="checkbox" checked={p.selected} onChange={(e) => patch(p.key, { selected: e.target.checked, substituteId: e.target.checked ? p.substituteId : '' })} />
                  第{p.period_no}節　{p.classLabel}／{p.subject}
                </label>
                {p.selected && (
                  <>
                    <select value={p.substituteId} onChange={(e) => patch(p.key, { substituteId: e.target.value })} style={{ padding: 5, fontSize: 13, minWidth: 200 }}>
                      <option value="">
                        {opt === 'loading' || opt === undefined ? '查詢空堂老師中…' : '先不選代課老師（待安排）'}
                      </option>
                      {(showAll ? teachers.filter((t) => t.id !== teacherId) : Array.isArray(opt) ? opt : []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {showAll ? '' : '（空堂）'}
                        </option>
                      ))}
                    </select>
                    {Array.isArray(opt) && opt.length === 0 && !showAll && <span style={{ fontSize: 11, color: '#A36A00' }}>這節查不到空堂老師</span>}
                    {!showAll && (
                      <button type="button" onClick={() => setShowAllFor((s) => ({ ...s, [p.key]: true }))} style={{ fontSize: 11, background: 'none', border: 'none', color: '#2C6E9E', cursor: 'pointer' }}>
                        改從全體老師選
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {chosen.length > 0 && (
        <button type="button" onClick={submit} disabled={busy} style={{ padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>
          {busy ? '送出中…' : `送出請假（共 ${chosen.length} 節）`}
        </button>
      )}
    </div>
  );
}

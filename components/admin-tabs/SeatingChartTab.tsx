'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useClassRoster, type RosterStudent } from '@/lib/useClassRoster';
import StudentPhoto from '@/components/StudentPhoto';

// 班級座位表（sql/152 的 class_seat_charts，一班一張）：
//   - 所有教職員：看各班座位表（有照片就顯示照片），可列印給任課老師認人
//   - 該班導師、教務處：排座位。電腦可以拖拉；手機用「點一下學生、再點一下位子」
// 位子的編號是「排-列」，排 0 最靠近講台。seats 只存 {位子: 學號}。

type Seats = Record<string, string>;
type Pick = { kind: 'seat'; key: string } | { kind: 'student'; no: string } | null;
const k = (r: number, c: number) => `${r}-${c}`;

export default function SeatingChartTab() {
  const { classes, classId, setClassId, current, students, photos, loading, error, canWrite } = useClassRoster();
  const [rows, setRows] = useState(7);
  const [cols, setCols] = useState(6);
  const [seats, setSeats] = useState<Seats>({});
  const [available, setAvailable] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [pick, setPick] = useState<Pick>(null);
  const [teacherView, setTeacherView] = useState(false);
  const [showPhoto, setShowPhoto] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setPick(null);
    setMsg('');
    setDirty(false);
    setEditing(false);
    if (!classId) return;
    let alive = true;
    setChartLoading(true);
    supabase
      .from('class_seat_charts')
      .select('seat_rows, seat_cols, seats')
      .eq('class_id', classId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (!alive) return;
        setAvailable(!err);
        setRows(data?.seat_rows ?? 7);
        setCols(data?.seat_cols ?? 6);
        setSeats((data?.seats as Seats) ?? {});
        setChartLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [classId]);

  const byNo = useMemo(() => new Map(students.map((s) => [s.student_no, s])), [students]);
  // 只認「還在這個班」而且位子在格子範圍內的學生；轉出的人自動從座位表消失
  const placed = useMemo(() => {
    const out: Seats = {};
    const seen = new Set<string>();
    for (const [key, no] of Object.entries(seats)) {
      const [r, c] = key.split('-').map(Number);
      if (r < rows && c < cols && byNo.has(no) && !seen.has(no)) {
        out[key] = no;
        seen.add(no);
      }
    }
    return out;
  }, [seats, rows, cols, byNo]);
  const seatedNos = useMemo(() => new Set(Object.values(placed)), [placed]);
  const unseated = students.filter((s) => !seatedNos.has(s.student_no));

  const change = (next: Seats) => {
    setSeats(next);
    setDirty(true);
    setMsg('');
  };

  // 把 from（學生或某個位子上的人）放到 toKey；目的地有人就交換（從名單來的話，原本的人回到名單）
  function drop(from: Exclude<Pick, null>, toKey: string) {
    const next = { ...placed };
    const occupant = next[toKey];
    if (from.kind === 'seat') {
      if (from.key === toKey) return;
      const mover = next[from.key];
      if (!mover) return;
      next[toKey] = mover;
      if (occupant) next[from.key] = occupant;
      else delete next[from.key];
    } else {
      next[toKey] = from.no;
    }
    change(next);
  }

  function clickSeat(key: string) {
    if (!editing) return;
    if (!pick) {
      if (placed[key]) setPick({ kind: 'seat', key });
      return;
    }
    if (pick.kind === 'seat' && pick.key === key) return setPick(null);
    drop(pick, key);
    setPick(null);
  }

  function unseat(key: string) {
    const next = { ...placed };
    delete next[key];
    change(next);
    setPick(null);
  }

  function autoFill() {
    if (Object.keys(placed).length > 0 && !confirm('要依座號重新排入嗎？目前排好的位子會被取代。')) return;
    // 依座號一直排：從靠講台、面對講台的左邊那一行開始，由前往後，排滿換下一行
    const sorted = [...students].sort((a, b) => (a.seat_no ?? 999) - (b.seat_no ?? 999));
    const next: Seats = {};
    let i = 0;
    for (let c = 0; c < cols && i < sorted.length; c++) for (let r = 0; r < rows && i < sorted.length; r++) next[k(r, c)] = sorted[i++].student_no;
    change(next);
    if (i < sorted.length) setMsg(`位子不夠：還有 ${sorted.length - i} 位學生沒排進去，請增加排數或列數。`);
  }

  async function save() {
    setSaving(true);
    const { error: err } = await supabase.from('class_seat_charts').upsert({ class_id: classId, seat_rows: rows, seat_cols: cols, seats: placed, updated_at: new Date().toISOString() });
    setSaving(false);
    if (err) return setMsg('儲存失敗：' + (/row-level security|policy/i.test(err.message) ? '沒有權限（只有該班導師與教務處可以排座位）' : err.message));
    setSeats(placed);
    setDirty(false);
    setMsg('座位表已儲存');
  }

  function resize(nr: number, nc: number) {
    const lost = Object.keys(placed).filter((key) => {
      const [r, c] = key.split('-').map(Number);
      return r >= nr || c >= nc;
    }).length;
    if (lost > 0 && !confirm(`縮小後有 ${lost} 位學生的位子會不見（回到未排名單），確定嗎？`)) return;
    setRows(nr);
    setCols(nc);
    setDirty(true);
  }

  const cell = (s: RosterStudent | undefined, key: string) => {
    const picked = pick?.kind === 'seat' && pick.key === key;
    return (
      <div
        key={key}
        className={'sc-seat' + (s ? ' has' : '') + (picked ? ' picked' : '') + (editing ? ' edit' : '')}
        onClick={() => clickSeat(key)}
        draggable={editing && !!s}
        onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'seat', key }))}
        onDragOver={(e) => editing && e.preventDefault()}
        onDrop={(e) => {
          if (!editing) return;
          e.preventDefault();
          try {
            drop(JSON.parse(e.dataTransfer.getData('text/plain')), key);
          } catch {
            /* 不是從這頁拖來的東西就略過 */
          }
          setPick(null);
        }}
        role={editing ? 'button' : undefined}
        tabIndex={editing ? 0 : undefined}
        onKeyDown={(e) => editing && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), clickSeat(key))}
        aria-label={s ? `${s.seat_no ?? ''}號 ${s.name}` : '空位'}
      >
        {s ? (
          <>
            {showPhoto && <StudentPhoto url={photos[s.student_no]} name={s.name} width={54} />}
            <span className="sc-no">{s.seat_no ?? '—'}</span>
            <span className="sc-name">{s.name}</span>
          </>
        ) : (
          <span className="sc-empty no-print">{editing ? '空位' : ''}</span>
        )}
      </div>
    );
  };

  // 學生視角：講台在上、排 0 在最上面；教師視角（站在講台往下看）：整張左右、前後都反過來
  const rIdx = Array.from({ length: rows }, (_, i) => i);
  const cIdx = Array.from({ length: cols }, (_, i) => i);
  const rOrder = teacherView ? [...rIdx].reverse() : rIdx;
  const cOrder = teacherView ? [...cIdx].reverse() : cIdx;
  const podium = <div className="sc-podium">講　台</div>;
  const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 14, cursor: 'pointer' };
  const busy = loading || chartLoading;
  const pickedSeatStudent = pick?.kind === 'seat' ? byNo.get(placed[pick.key]) : null;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <style>{`
        .sc-wrap { overflow-x: auto; padding-bottom: 6px; }
        .sc-grid { display: grid; gap: 8px; width: max-content; min-width: 100%; }
        .sc-seat { min-height: 62px; min-width: 76px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 6px 4px; border: 1px dashed var(--line-strong); border-radius: 10px; background: transparent; text-align: center; }
        .sc-seat.has { border-style: solid; background: var(--surface); }
        .sc-seat.edit { cursor: pointer; }
        .sc-seat.picked { outline: 3px solid var(--primary); outline-offset: 1px; background: var(--primary-soft); }
        .sc-no { font-size: 12px; color: var(--sub); line-height: 1; }
        .sc-name { font-size: 15px; font-weight: 700; line-height: 1.25; word-break: break-all; }
        .sc-empty { font-size: 12px; color: var(--sub); }
        .sc-podium { margin: 10px auto; width: min(60%, 320px); padding: 6px 0; text-align: center; font-weight: 700; letter-spacing: .3em; background: var(--primary-soft); border: 1px solid var(--line-strong); border-radius: 8px; }
        .sc-pool { display: flex; flex-wrap: wrap; gap: 6px; }
        .sc-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px !important; min-height: 0 !important; font-size: 14px !important; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface); cursor: pointer; }
        .sc-chip.picked { outline: 3px solid var(--primary); background: var(--primary-soft); }
        @media print {
          .no-print { display: none !important; }
          .sc-wrap { overflow: visible; }
          .sc-grid { width: 100%; gap: 4px; }
          .sc-seat { min-width: 0; border: 1px solid #666 !important; break-inside: avoid; }
          .sc-seat:not(.has) { border-style: dashed !important; }
          .sc-podium { border: 1px solid #666; background: #fff; }
        }
      `}</style>

      <h1 style={{ margin: '0 0 4px' }}>班級座位表{current ? `　${current.label}` : ''}</h1>
      <p className="no-print" style={{ fontSize: 13, color: 'var(--sub)', margin: '0 0 12px' }}>
        導師排好座位後，任課老師可以在這裡看座位認人，也可以列印帶去教室。
      </p>

      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <select
          value={classId}
          onChange={(e) => {
            if (dirty && !confirm('座位表還沒儲存，確定要換班級嗎？')) return;
            setClassId(e.target.value);
          }}
          style={{ padding: '6px 8px', fontSize: 15 }}
          aria-label="班級"
        >
          <option value="">請選擇班級</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        {classId && !busy && available && (
          <>
            <button type="button" style={btn} onClick={() => setTeacherView((v) => !v)} title="切換從哪一邊看教室">
              {teacherView ? '目前：講台往下看' : '目前：面向講台看'}
            </button>
            <label style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={showPhoto} onChange={(e) => setShowPhoto(e.target.checked)} /> 顯示照片
            </label>
            <button type="button" style={btn} onClick={() => window.print()}>列印</button>
            {canWrite && (
              <button type="button" className={editing ? 'btn-primary' : ''} style={btn} aria-pressed={editing} onClick={() => { setEditing((v) => !v); setPick(null); }}>
                {editing ? '結束排座位' : '排座位'}
              </button>
            )}
          </>
        )}
      </div>

      {!available && (
        <p className="no-print" style={{ background: '#FFF4D6', border: '1px solid #E4D5A8', color: '#8A5A00', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>
          座位表功能尚未啟用：請系統管理員先在資料庫執行 sql/152_student_photos_and_seating.sql。
        </p>
      )}
      {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
      {busy && classId && <p style={{ fontSize: 13, color: 'var(--sub)' }}>載入中…</p>}
      {!classId && !busy && <p style={{ fontSize: 14, color: 'var(--sub)' }}>請先選擇班級。</p>}

      {classId && !busy && available && (
        <>
          {editing && (
            <div className="no-print" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 14 }}>
                <label>直行 <select value={cols} onChange={(e) => resize(rows, Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                <label>橫排 <select value={rows} onChange={(e) => resize(Number(e.target.value), cols)}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                <button type="button" style={btn} onClick={autoFill}>依座號自動排入</button>
                <button type="button" style={btn} onClick={() => { if (confirm('確定要清空所有位子嗎？')) { change({}); setPick(null); } }}>全部清空</button>
                {pick?.kind === 'seat' && pickedSeatStudent && <button type="button" style={btn} onClick={() => unseat(pick.key)}>把 {pickedSeatStudent.name} 移出座位</button>}
                <button type="button" className="btn-primary" style={btn} disabled={saving || !dirty} onClick={save}>{saving ? '儲存中…' : dirty ? '儲存座位表' : '已儲存'}</button>
              </div>
              <div style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 6 }}>
                {pick ? '再點一個位子把他放過去（位子有人就互換）。' : '點一位學生，再點位子；兩個位子互點可以交換。電腦也可以直接拖拉。'}
                　還沒排位子：{unseated.length} 人
              </div>
              <div className="sc-pool">
                {unseated.map((s) => (
                  <button
                    key={s.student_no}
                    type="button"
                    className={'keep-size sc-chip' + (pick?.kind === 'student' && pick.no === s.student_no ? ' picked' : '')}
                    onClick={() => setPick(pick?.kind === 'student' && pick.no === s.student_no ? null : { kind: 'student', no: s.student_no })}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'student', no: s.student_no }))}
                  >
                    <StudentPhoto url={photos[s.student_no]} name={s.name} width={24} />
                    {s.seat_no ?? '—'} {s.name}
                  </button>
                ))}
                {unseated.length === 0 && students.length > 0 && <span style={{ fontSize: 13, color: 'var(--sub)' }}>全班都排好了 🎉</span>}
              </div>
            </div>
          )}
          {msg && <p className="no-print" role="status" style={{ fontSize: 13, color: 'var(--primary-ink)', margin: '0 0 10px' }}>{msg}</p>}
          {!editing && Object.keys(placed).length === 0 && (
            <p className="no-print" style={{ fontSize: 14, color: 'var(--sub)' }}>{canWrite ? '這個班還沒排座位，按「排座位」開始。' : '這個班的導師還沒排座位。'}</p>
          )}

          {(editing || Object.keys(placed).length > 0) && (
            <div className="sc-wrap">
              {!teacherView && podium}
              <div className="sc-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(76px, 1fr))` }}>
                {rOrder.map((r) => cOrder.map((c) => cell(byNo.get(placed[k(r, c)]), k(r, c))))}
              </div>
              {teacherView && podium}
            </div>
          )}
        </>
      )}
    </main>
  );
}

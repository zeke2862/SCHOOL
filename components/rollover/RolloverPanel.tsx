'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { departmentForGrade, SPECIFIC_GRADE_LEVELS } from '@/lib/gradeMapping';

// 新學期升級作業（整批、一次完成；邏輯在資料庫 sql/112_term_rollover.sql）。
//   同學年 上學期→下學期：學生留在原班，開新學期學籍，座號依學號重新排。
//   下學期→新學年上學期：升一年級（依「年級升級對照表」，沒填就用內建順序），新學年的班自動建立，座號依學號重新排。

export type TermRef = { year: number; term: string };

/** 一個學期的「上一個學期」：下學期 Y → 上學期 Y；上學期 Y → 下學期 Y-1 */
export function previousTermOf(t: TermRef): TermRef {
  return t.term === '下學期' ? { year: t.year, term: '上學期' } : { year: t.year - 1, term: '下學期' };
}

export function isSupportedRollover(src: TermRef, tgt: TermRef) {
  return (src.year === tgt.year && src.term === '上學期' && tgt.term === '下學期') || (tgt.year === src.year + 1 && src.term === '下學期' && tgt.term === '上學期');
}

export type ClassMapRule = { dept: string; grade: string; class: string; to_class?: string; to_dept?: string; to_grade?: string };
export type PreviewClass = { dept: string; grade: string; class: string; n: number; to_dept: string; to_grade: string; to_class: string; graduating: boolean; remapped: boolean };
export type RolloverPreview = { students: number; graduating: number; sameYear: boolean; classes: PreviewClass[]; newClasses: number };

export async function fetchRolloverPreview(src: TermRef, tgt: TermRef, promote = true, map: ClassMapRule[] = []) {
  const { data, error } = await supabase.rpc('rollover_preview', { p_sy: src.year, p_st: src.term, p_ty: tgt.year, p_tt: tgt.term, p_promote: promote, p_map: map });
  if (error) throw new Error(error.message);
  return data as RolloverPreview;
}

export default function RolloverPanel(props: { src: TermRef; tgt: TermRef; onDone?: () => void; onCancel?: () => void; cancelLabel?: string }) {
  const { src, tgt, onDone, onCancel, cancelLabel } = props;
  const [preview, setPreview] = useState<RolloverPreview | null>(null);
  // 班級改編（併班／擴班／改班名）：key = 部別|年級|班別；空白 = 不改
  const [edits, setEdits] = useState<Record<string, { to_class: string; to_grade: string }>>({});
  const [showMap, setShowMap] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [promote, setPromote] = useState(true);
  const [graduate, setGraduate] = useState(true);
  const [keepSeats, setKeepSeats] = useState(false);
  const supported = isSupportedRollover(src, tgt);
  const mapRules: ClassMapRule[] = Object.entries(edits)
    .filter(([, v]) => v.to_class.trim() || v.to_grade)
    .map(([k, v]) => {
      const [dept, grade, cls] = k.split('|');
      return { dept, grade, class: cls, to_class: v.to_class.trim() || undefined, to_grade: v.to_grade || undefined, to_dept: v.to_grade ? departmentForGrade(v.to_grade) : undefined };
    });
  const mapKey = JSON.stringify(mapRules);
  const sameYear = src.year === tgt.year;

  useEffect(() => {
    setPreview(null);
    setResult('');
    setError('');
    if (!supported) return;
    setLoading(true);
    fetchRolloverPreview(src, tgt, promote, mapRules)
      .then(setPreview)
      .catch((e) => setError(e.message + '（請確認 sql/112_term_rollover.sql 是否已執行，且您是教務主管或系統管理員）'))
      .finally(() => setLoading(false));
  }, [src.year, src.term, tgt.year, tgt.term, promote, supported, mapKey]);

  async function run() {
    if (!preview) return;
    setBusy(true);
    setError('');
    const { data, error } = await supabase.rpc('run_term_rollover', {
      p_sy: src.year, p_st: src.term, p_ty: tgt.year, p_tt: tgt.term, p_promote: promote, p_graduate: graduate, p_keep_seats: keepSeats, p_map: mapRules,
    });
    setBusy(false);
    if (error) {
      setError('升級作業失敗：' + error.message);
      return;
    }
    const d = data as { moved: number; graduated: number; newClasses: number };
    setResult(`✅ 完成：${d.moved} 位學生已建立 ${tgt.year} 學年度 ${tgt.term} 的學籍${d.graduated ? `；${d.graduated} 位畢業` : ''}${d.newClasses ? `；新增 ${d.newClasses} 個班` : ''}。`);
    setPreview(null);
    onDone?.();
  }

  const btn: React.CSSProperties = { padding: '8px 16px', fontSize: 13, cursor: 'pointer', borderRadius: 6 };

  if (!supported) {
    return <p style={{ fontSize: 13, color: '#A36A00' }}>只支援「同學年 上學期→下學期」或「下學期→下一學年上學期」。</p>;
  }

  return (
    <div style={{ fontSize: 13, lineHeight: 1.7 }}>
      <p style={{ margin: '0 0 8px' }}>
        <b>{src.year} 學年度 {src.term}</b> → <b>{tgt.year} 學年度 {tgt.term}</b>
      </p>
      {loading && <p style={{ color: '#2C6E9E' }}>計算中…</p>}
      {error && <p style={{ color: '#A32D2D' }}>{error}</p>}
      {result && <p style={{ color: '#3B6D11', fontWeight: 'bold' }}>{result}</p>}

      {preview && preview.students === 0 && !result && (
        <p style={{ color: '#888' }}>沒有需要升級的學生（可能已經升級過，或這個學期還沒有學籍資料）。</p>
      )}

      {preview && preview.students > 0 && (
        <>
          <p style={{ margin: '0 0 6px' }}>
            共 <b>{preview.students}</b> 位在籍學生
            {sameYear
              ? '：留在原班，開下學期學籍。'
              : promote
                ? `：升一年級${preview.graduating ? `，其中 ${preview.graduating} 位已是最高年級` : ''}${preview.newClasses ? `；新學年需新增 ${preview.newClasses} 個班` : ''}。`
                : `：維持原年級（不升級）${preview.newClasses ? `；新學年需新增 ${preview.newClasses} 個班` : ''}。`}
          </p>
          <button type="button" onClick={() => setShowMap((v) => !v)} style={{ fontSize: 12, background: 'none', border: 'none', color: '#2C6E9E', cursor: 'pointer', padding: 0, marginBottom: 6 }}>
            {showMap ? '▾ 收起各班去向' : '▸ 查看各班去向／併班、擴班、改班名'}{mapRules.length ? `（已設定 ${mapRules.length} 筆改編）` : ''}
          </button>
          {showMap && (
            <div style={{ border: '1px solid #eee', borderRadius: 6, margin: '4px 0 8px', maxHeight: 280, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f5f5f3', textAlign: 'left' }}>
                    <th style={{ padding: 4 }}>現在的班</th>
                    <th style={{ padding: 4 }}>人數</th>
                    <th style={{ padding: 4 }}>升級後</th>
                    <th style={{ padding: 4 }}>改編：班別</th>
                    <th style={{ padding: 4 }}>改編：年級</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.classes.map((c) => {
                    const key = `${c.dept}|${c.grade}|${c.class}`;
                    const e = edits[key] ?? { to_class: '', to_grade: '' };
                    return (
                      <tr key={key} style={{ borderTop: '1px solid #f0f0f0', background: c.remapped ? '#FFF8E1' : undefined }}>
                        <td style={{ padding: 4 }}>{c.grade}{c.class}</td>
                        <td style={{ padding: 4 }}>{c.n}</td>
                        <td style={{ padding: 4 }}>{c.graduating ? '畢業' : `${c.to_grade}${c.to_class}`}</td>
                        <td style={{ padding: 4 }}>
                          <input value={e.to_class} placeholder="不變" onChange={(ev) => setEdits((p) => ({ ...p, [key]: { ...e, to_class: ev.target.value } }))} style={{ width: 70, padding: 3 }} />
                        </td>
                        <td style={{ padding: 4 }}>
                          <select value={e.to_grade} onChange={(ev) => setEdits((p) => ({ ...p, [key]: { ...e, to_grade: ev.target.value } }))} style={{ padding: 3 }}>
                            <option value="">依升級對照</option>
                            {SPECIFIC_GRADE_LEVELS.filter((g) => g !== '幼兒園').map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ fontSize: 11, color: '#888', margin: 6 }}>
                併班：把幾個班的「改編：班別」填成同一個名字（例如 5年孝、5年忠 都填「忠」，升級後就合成一班）。
                擴班（一班拆兩班）：先在這裡把整班升上去，之後在「學生名冊」把部分學生調到新班。
              </p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '8px 0 12px' }}>
            {!sameYear && (
              <label>
                <input type="checkbox" checked={promote} onChange={(e) => setPromote(e.target.checked)} /> 升一年級（取消勾選＝全部留在原年級，只開新學年學籍）
              </label>
            )}
            {!sameYear && promote && preview.graduating > 0 && (
              <label>
                <input type="checkbox" checked={graduate} onChange={(e) => setGraduate(e.target.checked)} /> 最高年級的 {preview.graduating} 位學生標記為「畢業」
              </label>
            )}
            {sameYear && (
              <label>
                <input type="checkbox" checked={keepSeats} onChange={(e) => setKeepSeats(e.target.checked)} /> 沿用原座號（取消勾選＝依學號重新排座號）
              </label>
            )}
            <span style={{ fontSize: 12, color: '#888' }}>座號預設：每班依學號由小到大重新排 1、2、3…。舊學期的學籍與成績都會保留，不會被覆蓋。</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={run} disabled={busy} style={{ ...btn, background: '#2C2C2A', color: '#fff', border: 'none' }}>
              {busy ? '處理中…' : `執行升級（${preview.students} 位）`}
            </button>
            {onCancel && (
              <button onClick={onCancel} disabled={busy} style={{ ...btn, background: '#fff', border: '1px solid #ccc' }}>
                {cancelLabel ?? '稍後再說'}
              </button>
            )}
          </div>
        </>
      )}
      {(result || (preview && preview.students === 0)) && onCancel && (
        <button onClick={onCancel} style={{ ...btn, background: '#fff', border: '1px solid #ccc', marginTop: 8 }}>
          關閉
        </button>
      )}
    </div>
  );
}

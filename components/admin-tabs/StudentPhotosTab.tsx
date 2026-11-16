'use client';

import { useRef, useState } from 'react';
import { useClassRoster, type RosterStudent } from '@/lib/useClassRoster';
import { deleteStudentPhoto, matchFileToStudent, uploadStudentPhoto } from '@/lib/studentPhotos';
import StudentPhoto from '@/components/StudentPhoto';

// 學生照片（班級相片名冊）：
//   - 所有教職員：選班級，看全班的臉和名字，可列印成相片名冊
//   - 該班導師、教務處：點學生的照片框上傳（手機可直接拍），或一次選全班照片批次上傳
// 照片上傳前會在瀏覽器裁成 3:4 並壓到約 40KB 以內，放在私有空間（sql/152）。

type BatchResult = { ok: string[]; failed: { file: string; why: string }[]; unmatched: string[] };

export default function StudentPhotosTab() {
  const { classes, classId, setClassId, current, students, photos, photosAvailable, loading, error, canWrite, reloadPhotos } = useClassRoster();
  const [busyNo, setBusyNo] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [big, setBig] = useState<RosterStudent | null>(null);
  const singleInput = useRef<HTMLInputElement>(null);
  const batchInput = useRef<HTMLInputElement>(null);
  const target = useRef<RosterStudent | null>(null);

  const nos = students.map((s) => s.student_no);
  const have = students.filter((s) => photos[s.student_no]).length;

  function pick(s: RosterStudent) {
    target.current = s;
    singleInput.current?.click();
  }

  async function onSingle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const s = target.current;
    if (!file || !s) return;
    setBusyNo(s.student_no);
    setMsg('');
    try {
      await uploadStudentPhoto(s.student_no, file);
      await reloadPhotos(nos);
      setMsg(`已更新 ${s.seat_no ?? ''} ${s.name} 的照片`);
    } catch (err: any) {
      setMsg(`${s.name} 上傳失敗：${err?.message ?? err}`);
    }
    setBusyNo(null);
  }

  async function remove(s: RosterStudent) {
    if (!confirm(`確定要刪除 ${s.name} 的照片嗎？刪除後無法復原，需要重新上傳。`)) return;
    setBusyNo(s.student_no);
    setMsg('');
    try {
      await deleteStudentPhoto(s.student_no);
      await reloadPhotos(nos);
      setMsg(`已刪除 ${s.name} 的照片`);
    } catch (err: any) {
      setMsg(`刪除失敗：${err?.message ?? err}`);
    }
    setBusyNo(null);
  }

  async function onBatch(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const res: BatchResult = { ok: [], failed: [], unmatched: [] };
    const jobs: { file: File; s: RosterStudent }[] = [];
    const used = new Set<string>();
    for (const f of files) {
      const s = matchFileToStudent(f.name, students);
      if (!s) res.unmatched.push(f.name);
      else if (used.has(s.student_no)) res.failed.push({ file: f.name, why: `和另一個檔案對到同一位學生（${s.name}）` });
      else {
        used.add(s.student_no);
        jobs.push({ file: f, s });
      }
    }
    const replace = jobs.filter((j) => photos[j.s.student_no]).length;
    if (jobs.length > 0 && replace > 0 && !confirm(`有 ${replace} 位學生已經有照片，要用新的照片取代嗎？`)) return;
    setResult(null);
    setMsg('');
    setBatch({ done: 0, total: jobs.length });
    // 一次傳 3 張，不佔滿學校網路
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        try {
          await uploadStudentPhoto(j.s.student_no, j.file);
          res.ok.push(`${j.s.seat_no ?? ''} ${j.s.name}`);
        } catch (err: any) {
          res.failed.push({ file: j.file.name, why: err?.message ?? String(err) });
        }
        setBatch({ done: ++done, total: jobs.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await reloadPhotos(nos);
    setBatch(null);
    setResult(res);
  }

  const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 14, cursor: 'pointer' };

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <style>{`
        .sp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 12px; }
        .sp-card { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; text-align: center; }
        .sp-photo { position: relative; padding: 0 !important; border: 0 !important; background: none !important; box-shadow: none !important; min-height: 0 !important; line-height: 0; cursor: pointer; border-radius: 9px; }
        .sp-photo .sp-hint { position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 0; font-size: 12px !important; line-height: 1.3; color: #fff; background: rgba(0,0,0,.55); border-radius: 0 0 9px 9px; }
        .sp-name { font-size: 14px; font-weight: 700; line-height: 1.3; word-break: break-all; }
        .sp-seat { font-size: 12px; color: var(--sub); }
        @media print {
          .no-print { display: none !important; }
          .sp-grid { grid-template-columns: repeat(7, 1fr); gap: 6px; }
          .sp-card { border: 1px solid #999; break-inside: avoid; padding: 4px 2px; }
          .sp-name { font-size: 11pt; }
        }
      `}</style>

      <h1 style={{ margin: '0 0 4px' }}>學生照片{current ? `　${current.label}` : ''}</h1>
      <p className="no-print" style={{ fontSize: 13, color: 'var(--sub)', margin: '0 0 12px' }}>
        看臉記名字用的班級相片名冊。照片只有登入的教職員看得到，家長與學生看不到。
      </p>

      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <select value={classId} onChange={(e) => { setClassId(e.target.value); setResult(null); setMsg(''); setEditing(false); }} style={{ padding: '6px 8px', fontSize: 15 }} aria-label="班級">
          <option value="">請選擇班級</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        {classId && !loading && <span style={{ fontSize: 13, color: 'var(--sub)' }}>已有照片 {have} / {students.length} 人</span>}
        {classId && students.length > 0 && <button type="button" style={btn} onClick={() => window.print()}>列印相片名冊</button>}
        {canWrite && photosAvailable && students.length > 0 && (
          <>
            <button type="button" className={editing ? 'btn-primary' : ''} style={btn} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
              {editing ? '完成' : '上傳／更換照片'}
            </button>
            <button type="button" style={btn} disabled={!!batch} onClick={() => batchInput.current?.click()}>
              {batch ? `上傳中 ${batch.done}/${batch.total}…` : '批次上傳全班'}
            </button>
          </>
        )}
      </div>

      <input ref={singleInput} type="file" accept="image/*" hidden onChange={onSingle} />
      <input ref={batchInput} type="file" accept="image/*" multiple hidden onChange={onBatch} />

      {!photosAvailable && (
        <p className="no-print" style={{ background: '#FFF4D6', border: '1px solid #E4D5A8', color: '#8A5A00', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>
          照片功能尚未啟用：請系統管理員先在資料庫執行 sql/152_student_photos_and_seating.sql。
        </p>
      )}
      {canWrite && photosAvailable && editing && (
        <p className="no-print" style={{ fontSize: 13, color: 'var(--sub)', margin: '0 0 10px', lineHeight: 1.7 }}>
          點學生的照片框就能選照片（手機可以直接拍）。系統會自動裁成直式大頭照並縮小，原圖多大都沒關係。
          <br />
          批次上傳：一次選全班的照片，檔名用<b>座號</b>（例如 05.jpg）、<b>學號</b>或<b>姓名</b>，系統會自動對應。
        </p>
      )}
      {msg && <p className="no-print" role="status" style={{ fontSize: 13, color: 'var(--primary-ink)', margin: '0 0 10px' }}>{msg}</p>}
      {result && (
        <div className="no-print" role="status" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13, lineHeight: 1.7 }}>
          <div><b>批次上傳結果</b>：成功 {result.ok.length} 張{result.failed.length > 0 && `，失敗 ${result.failed.length} 張`}{result.unmatched.length > 0 && `，對不到學生 ${result.unmatched.length} 張`}</div>
          {result.unmatched.length > 0 && <div style={{ color: '#8A5A00' }}>對不到學生的檔案（請改檔名，或按「上傳／更換照片」個別指定）：{result.unmatched.join('、')}</div>}
          {result.failed.map((f) => (
            <div key={f.file} style={{ color: '#A32D2D' }}>{f.file}：{f.why}</div>
          ))}
        </div>
      )}
      {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
      {loading && classId && <p style={{ fontSize: 13, color: 'var(--sub)' }}>載入中…</p>}
      {!classId && !loading && <p style={{ fontSize: 14, color: 'var(--sub)' }}>請先選擇班級。</p>}
      {classId && !loading && students.length === 0 && !error && <p style={{ fontSize: 14, color: 'var(--sub)' }}>這個班目前沒有在籍學生。</p>}

      <div className="sp-grid">
        {students.map((s) => {
          const url = photos[s.student_no];
          const busy = busyNo === s.student_no;
          return (
            <div key={s.student_no} className="sp-card">
              <button
                type="button"
                className="keep-size sp-photo"
                disabled={busy}
                onClick={() => (editing ? pick(s) : url ? setBig(s) : canWrite && photosAvailable ? pick(s) : undefined)}
                aria-label={editing || !url ? `上傳 ${s.name} 的照片` : `放大 ${s.name} 的照片`}
              >
                <StudentPhoto url={url} name={s.name} width={96} />
                {busy && <span className="sp-hint">處理中…</span>}
                {!busy && editing && <span className="sp-hint no-print">{url ? '更換' : '上傳'}</span>}
              </button>
              <span className="sp-seat">{s.seat_no ?? '—'} 號</span>
              <span className="sp-name">{s.name}</span>
              {editing && url && !busy && (
                <button type="button" className="keep-size no-print" onClick={() => remove(s)} style={{ fontSize: 12, padding: '1px 8px', minHeight: 0, color: '#A32D2D' }}>
                  刪除
                </button>
              )}
            </div>
          );
        })}
      </div>

      {big && (
        <div className="no-print" role="dialog" aria-label={`${big.name} 的照片`} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }} onClick={() => setBig(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 16, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <StudentPhoto url={photos[big.student_no]} name={big.name} width={240} />
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>{big.seat_no ?? '—'} 號　{big.name}</div>
            <div style={{ fontSize: 13, color: 'var(--sub)' }}>{big.student_no}</div>
            <button type="button" onClick={() => setBig(null)} style={{ ...btn, marginTop: 10 }}>關閉</button>
          </div>
        </div>
      )}
    </main>
  );
}

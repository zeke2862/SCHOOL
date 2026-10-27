'use client';

import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  DEPTS,
  DEPT_LABEL,
  defsOfDept,
  exportDepartment,
  exportDepartments,
  exportAttendanceFull,
  zipResults,
  zipFileName,
  saveBytes,
  XLSX_MIME,
  parseWorkbookFiles,
  runImportPlan,
  runBackupBeforeImport,
  type DeptExportResult,
  type ImportPlan,
  type ImportSheetResult,
} from '@/lib/deptWorkbook';
import type { DeptKey } from '@/lib/deptTableDefs';

const DEPT_DESC: Record<DeptKey, string> = {
  academic: '學生／班級／教師、課表與代課、成績、考試分班、社團、教職員打卡',
  general: '校服／簿本／書庫庫存、修繕、水電網路費用',
  discipline: '出缺勤（例外紀錄）、示警通知、獎懲與審核、資料修改申請',
  dev: '帳號與部門職務、功能卡片、送審、公佈欄、系統設定、聘書與教師歷年資料',
};

const btn = (primary = false): React.CSSProperties => ({
  padding: '8px 16px',
  background: primary ? '#2C6E9E' : '#fff',
  color: primary ? '#fff' : '#2C6E9E',
  border: '1px solid #2C6E9E',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
});

export default function DeptWorkbookPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<DeptExportResult[] | null>(null);

  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [backupFirst, setBackupFirst] = useState(true);
  const [results, setResults] = useState<ImportSheetResult[] | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    if (!t) throw new Error('登入已過期，請重新登入後再試一次');
    return t;
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return null;
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  // ---------------- 下載 ----------------
  async function downloadOne(dept: DeptKey) {
    await run(async () => {
      const token = await getToken();
      const r = await exportDepartment(dept, { token, onProgress: setProgress });
      saveBytes(r.data, r.fileName, XLSX_MIME);
      setLastExport([r]);
    });
  }

  async function downloadAllZip() {
    await run(async () => {
      const token = await getToken();
      const rs = await exportDepartments(DEPTS, { token, onProgress: setProgress });
      saveBytes(zipResults(rs), zipFileName(), 'application/zip');
      setLastExport(rs);
    });
  }

  async function downloadAllSeparate() {
    await run(async () => {
      const token = await getToken();
      const rs = await exportDepartments(DEPTS, { token, onProgress: setProgress });
      // 瀏覽器連續下載多個檔案時，第一次可能會詢問「是否允許下載多個檔案」，請按允許
      for (const r of rs) {
        saveBytes(r.data, r.fileName, XLSX_MIME);
        await new Promise((res) => setTimeout(res, 700));
      }
      setLastExport(rs);
    });
  }

  async function downloadAttendanceFull() {
    if (!confirm('完整出缺勤（連「出席」也包含）有幾十萬列，會切成很多個 Excel 檔再打包成 ZIP，需要幾分鐘，電腦記憶體也要夠用。\n\n確定要下載嗎？')) return;
    await run(async () => {
      const token = await getToken();
      const rs = await exportAttendanceFull({ token, onProgress: setProgress });
      saveBytes(zipResults(rs), `school-data_3-discipline_attendance-full_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.zip`, 'application/zip');
      setLastExport(rs);
    });
  }

  // ---------------- 上傳（先檢查，再確認寫入） ----------------
  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setPlan(null);
    setResults(null);
    setShowAllErrors(false);
    await run(async () => {
      const p = await parseWorkbookFiles(files, setProgress);
      setPlan(p);
    });
  }

  async function confirmImport() {
    if (!plan) return;
    if (!confirm(`即將把 ${plan.validRows} 列資料寫進資料庫（新增＋更新，不會刪除任何資料）。\n\n確定要開始嗎？`)) return;
    await run(async () => {
      const token = await getToken();
      if (backupFirst) {
        await runBackupBeforeImport(token, setProgress);
      }
      const rs = await runImportPlan(plan, { token, onProgress: setProgress });
      setResults(rs);
      setPlan(null);
      if (fileRef.current) fileRef.current.value = '';
    });
  }

  const planByDept = plan
    ? DEPTS.map((d) => ({ dept: d, sheets: plan.sheets.filter((s) => s.dept === d) })).filter((x) => x.sheets.length > 0)
    : [];
  const totalErrors = plan ? plan.sheets.reduce((n, s) => n + s.errors.length, 0) : 0;

  return (
    <div>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 12, lineHeight: 1.7 }}>
        把系統裡「所有資料」依部門分成 <b>教務、總務、訓導、開發人員</b> 四個 Excel（每張資料表一個分頁）。
        可以一鍵全部下載，改完後也可以一次把四個檔案（或一個 ZIP）全部上傳回來。
        上傳是「新增＋更新」，不會刪除 Excel 裡沒有的資料；寫入前還會先自動備份一份，改錯了隨時能還原。
      </p>

      {/* ---------------- 下載 ---------------- */}
      <h3 style={{ fontSize: 13, margin: '16px 0 8px' }}>① 下載</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" style={btn(true)} disabled={busy} onClick={downloadAllZip}>
          ↓ 一鍵下載全部（四個 Excel 打包成 1 個 ZIP）
        </button>
        <button type="button" style={btn()} disabled={busy} onClick={downloadAllSeparate}>
          ↓ 連續下載 4 個 Excel（不打包）
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginBottom: 12 }}>
        {DEPTS.map((d) => (
          <div key={d} style={{ border: '1px solid #e3e3e3', borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>
              {DEPT_LABEL[d]}（{defsOfDept(d).length} 張資料表）
            </div>
            <div style={{ fontSize: 11, color: '#777', minHeight: 48, lineHeight: 1.5 }}>{DEPT_DESC[d]}</div>
            <button type="button" style={{ ...btn(), marginTop: 6, padding: '6px 12px' }} disabled={busy} onClick={() => downloadOne(d)}>
              ↓ 只下載{DEPT_LABEL[d]}
            </button>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: '#999', lineHeight: 1.6, marginBottom: 6 }}>
        出缺勤只放遲到／曠課／請假等「非出席」紀錄，另附「點名完成」分頁（attendance_roll_calls，每班每天每節一筆）：
        有點名、又沒有非出席紀錄＝全員出席；沒有點名紀錄＝還沒點名。檔案只有完整版的約 2～3%。JSON 備份也是同樣做法。
        上傳時要把某節改回出席，請在 attendance 分頁明確寫「出席」。極少數情況真的需要舊格式（含每一筆出席）時：
        <button type="button" onClick={downloadAttendanceFull} disabled={busy} style={{ ...btn(), padding: '2px 8px', fontSize: 11, marginLeft: 6 }}>
          下載舊格式完整出缺勤（含出席，ZIP，不建議）
        </button>
      </p>

      {/* ---------------- 上傳 ---------------- */}
      <h3 style={{ fontSize: 13, margin: '20px 0 8px' }}>② 上傳（四個檔案一次選，或選一個 ZIP）</h3>
      <input ref={fileRef} type="file" accept=".xlsx,.zip" multiple onChange={handleFiles} disabled={busy} style={{ fontSize: 13 }} />
      <p style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
        選好檔案後會先「檢查」（不會寫入），看過結果再按確認。帳號名單、稽核紀錄這類「只供下載」的分頁會自動略過。
      </p>

      {busy && (
        <p style={{ fontSize: 12, color: '#2C6E9E', marginTop: 10 }}>
          處理中…{progress ? ' ' + progress : ''}（資料量大時要等一下，請不要關掉這個頁面）
        </p>
      )}
      {error && <p style={{ fontSize: 12, color: '#A32D2D', marginTop: 10 }}>發生問題：{error}</p>}

      {plan && (
        <div style={{ marginTop: 14, border: '1px solid #cfe0ee', background: '#f6fafd', borderRadius: 8, padding: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 6 }}>
            檢查結果：讀到 {plan.fileCount} 個檔案、{plan.sheets.length} 張資料表、共 {plan.validRows} 列可以寫入
            {totalErrors > 0 ? `，另有 ${totalErrors} 個問題（有問題的列會略過，其餘照常寫入）` : '，沒有發現問題 ✅'}
          </p>
          {planByDept.map(({ dept, sheets }) => (
            <div key={dept} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: '#2C6E9E', marginBottom: 2 }}>{DEPT_LABEL[dept]}</div>
              <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#666' }}>
                    <th style={{ padding: '2px 6px' }}>資料表</th>
                    <th style={{ padding: '2px 6px' }}>可寫入列數</th>
                    <th style={{ padding: '2px 6px' }}>其中新增</th>
                    <th style={{ padding: '2px 6px' }}>問題</th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.map((s) => (
                    <tr key={s.table} style={{ borderTop: '1px solid #e6eef5' }}>
                      <td style={{ padding: '2px 6px' }}>
                        {s.label} <span style={{ color: '#aaa' }}>({s.table})</span>
                      </td>
                      <td style={{ padding: '2px 6px' }}>{s.rows.length}</td>
                      <td style={{ padding: '2px 6px' }}>{s.newRows}</td>
                      <td style={{ padding: '2px 6px', color: s.errors.length ? '#A32D2D' : '#3B6D11' }}>{s.errors.length || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {plan.ignored.length > 0 && (
            <p style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
              已略過：{plan.ignored.map((i) => `${i.sheet}（${i.reason}）`).join('；')}
            </p>
          )}
          {totalErrors > 0 && (
            <div style={{ fontSize: 12, color: '#A32D2D', marginBottom: 8 }}>
              <button type="button" onClick={() => setShowAllErrors(!showAllErrors)} style={{ ...btn(), fontSize: 11, padding: '2px 8px' }}>
                {showAllErrors ? '收合問題清單' : '看問題清單'}
              </button>
              {showAllErrors && (
                <ul style={{ paddingLeft: 18, marginTop: 6 }}>
                  {plan.sheets.flatMap((s) => s.errors.map((e) => `${s.label}：${e}`)).slice(0, 100).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {totalErrors > 100 && <li>…還有 {totalErrors - 100} 個</li>}
                </ul>
              )}
            </div>
          )}
          <label style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            <input type="checkbox" checked={backupFirst} onChange={(e) => setBackupFirst(e.target.checked)} /> 寫入前先自動備份一份（建議保持勾選）
          </label>
          <button type="button" style={btn(true)} disabled={busy || plan.validRows === 0} onClick={confirmImport}>
            確認寫入資料庫（{plan.validRows} 列）
          </button>
          <button
            type="button"
            style={{ ...btn(), marginLeft: 8 }}
            disabled={busy}
            onClick={() => {
              setPlan(null);
              if (fileRef.current) fileRef.current.value = '';
            }}
          >
            取消
          </button>
        </div>
      )}

      {results && (
        <div style={{ marginTop: 14, fontSize: 12 }}>
          <p style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 6 }}>
            寫入完成：成功 {results.reduce((n, r) => n + r.ok, 0)} 列，失敗 {results.reduce((n, r) => n + r.failed, 0)} 列
          </p>
          {results.map((r, i) => (
            <div key={r.table + i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #eee' }}>
              <b>{r.label}</b> <span style={{ color: '#aaa' }}>({r.table})</span>：
              <span style={{ color: '#3B6D11' }}> 成功 {r.ok}</span>
              {r.failed > 0 && <span style={{ color: '#A32D2D' }}>，失敗 {r.failed}</span>}
              {r.errors.length > 0 && (
                <ul style={{ color: '#A32D2D', paddingLeft: 18, marginTop: 2 }}>
                  {r.errors.slice(0, 8).map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                  {r.errors.length > 8 && <li>…還有 {r.errors.length - 8} 則</li>}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {lastExport && (
        <details style={{ marginTop: 14, fontSize: 12, color: '#555' }}>
          <summary style={{ cursor: 'pointer' }}>剛剛下載的內容明細</summary>
          {lastExport.map((r) => (
            <div key={r.fileName} style={{ marginTop: 6 }}>
              <b>{r.fileName}</b>
              <ul style={{ paddingLeft: 18 }}>
                {r.summary.map((s) => (
                  <li key={s.sheet + s.table}>
                    {s.label}（{s.sheet}）：{s.rows} 筆{s.note ? ` — ${s.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

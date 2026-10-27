'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { runBackupBeforeImport } from '@/lib/deptWorkbook';

type Scan = {
  totalRows: number;
  assignmentRows: number;
  distinctAssignments: number;
  duplicateGroups: number;
  extraRows: number;
  slotRows: number;
  onlyInSlots: number;
  onlyInAssign: number;
  detail: { cls: string; academicYear: number; term: string; subject: string; teacher: string; copies: number }[];
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

// 課表資料整理：找出並清掉「任課教師設定」重複列（只有系統管理員S／開發人員能用，伺服器端會再檢查一次）
export default function ScheduleDuplicatesPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  async function token() {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error('登入已過期，請重新登入');
    return data.session.access_token;
  }
  async function call(action: 'scan' | 'apply') {
    const res = await fetch('/api/admin/schedule-cleanup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error(body?.error ?? `伺服器沒有正常回應（HTTP ${res.status}）`);
    return body;
  }

  async function doScan() {
    setBusy(true);
    setError(null);
    setDoneMsg(null);
    setMsg('檢查中…');
    try {
      setScan(await call('scan'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      setMsg('');
    }
  }

  async function doApply() {
    if (!scan) return;
    if (!confirm(`將刪除 ${scan.extraRows} 筆多餘的重複列（每組保留 1 筆），刪除前會先自動備份。\n確定要整理嗎？`)) return;
    setBusy(true);
    setError(null);
    try {
      await runBackupBeforeImport(await token(), (m) => setMsg(m));
      setMsg('整理中…');
      const r = await call('apply');
      setDoneMsg(`已刪除 ${r.deleted} 筆重複列。`);
      setScan(await call('scan'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      setMsg('');
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h2 style={{ fontSize: 15, marginBottom: 6 }}>課表資料整理（任課教師設定重複列）</h2>
      <p style={{ fontSize: 12, color: '#666', lineHeight: 1.7, marginBottom: 12 }}>
        課表資料表裡，有一種資料是「這個班這一科由誰教」（沒有星期、沒有節次）。以前每次上傳「任課教師設定」或在排課工具按存檔，
        只要同一班同一科已經有 2 筆以上，程式就會多新增一筆，越積越多。這裡可以先檢查有多少重複，再一鍵清掉多餘的（每組保留 1 筆）。
        <b> 有排星期、節次的正式課表完全不會動。</b>
      </p>
      <button type="button" style={btn(true)} disabled={busy} onClick={doScan}>
        檢查重複
      </button>
      {busy && <p style={{ fontSize: 12, color: '#2C6E9E', marginTop: 8 }}>{msg || '處理中…'}</p>}
      {error && <p style={{ fontSize: 12, color: '#A32D2D', marginTop: 8 }}>發生問題：{error}</p>}
      {doneMsg && <p style={{ fontSize: 13, color: '#3B6D11', marginTop: 8 }}>✅ {doneMsg}</p>}

      {scan && (
        <div style={{ marginTop: 14 }}>
          <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['課表資料表總列數', scan.totalRows],
                ['其中「任課教師設定」列（沒有星期節次）', scan.assignmentRows],
                ['不重複的「班級＋科目＋老師」組合', scan.distinctAssignments],
                ['有重複的組合數', scan.duplicateGroups],
                ['可以刪掉的多餘列', scan.extraRows],
                ['有排星期節次的正式課表列', scan.slotRows],
              ].map(([k, v]) => (
                <tr key={String(k)}>
                  <td style={{ padding: '3px 12px 3px 0', color: '#666' }}>{k}</td>
                  <td style={{ padding: '3px 0', fontWeight: 'bold', color: k === '可以刪掉的多餘列' && Number(v) > 0 ? '#A32D2D' : undefined }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(scan.onlyInSlots > 0 || scan.onlyInAssign > 0) && (
            <p style={{ fontSize: 12, color: '#A36A00', background: '#FFF8E1', border: '1px solid #f0d98a', borderRadius: 8, padding: '8px 12px', marginTop: 10, lineHeight: 1.7 }}>
              另外提醒（不會自動修改，請人工確認）：有 {scan.onlyInSlots} 組「班級＋科目＋老師」有排進課表節次、但沒有對應的任課教師設定；
              有 {scan.onlyInAssign} 組有任課教師設定、但沒有排進課表節次。常見原因是科目名稱兩邊寫法不同（例如「弟子」與「弟子規」、「拚音」與「拼音」）。
            </p>
          )}
          {scan.extraRows > 0 && (
            <button type="button" style={{ ...btn(true), marginTop: 12 }} disabled={busy} onClick={doApply}>
              清掉 {scan.extraRows} 筆多餘重複列（會先自動備份）
            </button>
          )}
          {scan.extraRows === 0 && <p style={{ fontSize: 13, color: '#3B6D11', marginTop: 10 }}>沒有發現重複列 ✅</p>}
          {scan.detail.length > 0 && (
            <details style={{ marginTop: 12, fontSize: 12 }}>
              <summary style={{ cursor: 'pointer' }}>看重複明細（前 {scan.detail.length} 組）</summary>
              <table style={{ borderCollapse: 'collapse', marginTop: 6 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#666' }}>
                    <th style={{ padding: '2px 8px' }}>班級</th>
                    <th style={{ padding: '2px 8px' }}>科目</th>
                    <th style={{ padding: '2px 8px' }}>老師</th>
                    <th style={{ padding: '2px 8px' }}>學年學期</th>
                    <th style={{ padding: '2px 8px' }}>重複幾筆</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.detail.map((d, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '2px 8px' }}>{d.cls}</td>
                      <td style={{ padding: '2px 8px' }}>{d.subject}</td>
                      <td style={{ padding: '2px 8px' }}>{d.teacher}</td>
                      <td style={{ padding: '2px 8px' }}>
                        {d.academicYear} {d.term}
                      </td>
                      <td style={{ padding: '2px 8px' }}>{d.copies}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

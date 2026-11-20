'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// 系統健康檢查（資安與效能檢測報告 第三級：監控與告警）。
// 每天排程自動檢查一次（有問題會寄信給系統管理員 S，需要有設定寄信）；這裡可以隨時手動檢查、驗證最新備份、清理舊備份。
// 操作說明與「備份還原演練」步驟見 docs/備份還原演練與維運手冊.md。

type Alert = { level: 'warning' | 'critical'; key: string; message: string };
type Verify = {
  ok: boolean;
  backupId: string | null;
  createdAt: string | null;
  ageHours: number | null;
  tablesChecked: number;
  totalRows: number;
  problems: string[];
  warnings: string[];
  durationMs: number;
};
type Report = {
  checkedAt: string;
  status: 'ok' | 'warning' | 'critical';
  alerts: Alert[];
  metrics: { snapshot: any; pingMs: number | null; latestBackup: { ageHours: number; totalRows: number } | null; limits: { storageBytes: number; dbBytes: number }; prune: { removeCount: number; freeMB: number } | null };
};
type HistoryRow = { id: number; checked_at: string; source: 'cron' | 'manual'; status: 'ok' | 'warning' | 'critical'; alerts: Alert[] };

const MB = 1048576;
const STATUS_LABEL = { ok: '正常', warning: '警告', critical: '嚴重' } as const;
const STATUS_COLOR = { ok: '#3B6D11', warning: '#B7791F', critical: '#A32D2D' } as const;

function Bar({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const color = pct >= 90 ? STATUS_COLOR.critical : pct >= 70 ? STATUS_COLOR.warning : STATUS_COLOR.ok;
  return (
    <div style={{ background: 'var(--line)', borderRadius: 4, height: 8, width: 160, display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }}>
      <div style={{ width: `${pct}%`, background: color, height: 8, borderRadius: 4 }} />
    </div>
  );
}

export default function SystemHealthPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [lastVerify, setLastVerify] = useState<Verify | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const call = useCallback(async (method: 'GET' | 'POST', body?: Record<string, unknown>) => {
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/health', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `失敗（${res.status}）`);
    return json;
  }, []);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const j = await call('GET');
      setReport(j.report);
      setLastVerify(j.lastVerify);
      setHistory(j.history);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  async function action(name: 'check' | 'verify' | 'prune', label: string) {
    if (name === 'prune') {
      try {
        const p = await call('POST', { action: 'prune-preview' });
        if (p.removeCount === 0) {
          setMessage('目前沒有需要清理的舊備份。');
          return;
        }
        if (!window.confirm(`依保留規則，將刪除 ${p.removeCount} 份舊備份（共 ${p.total} 份），約釋放 ${p.freeMB} MB。\n刪除後無法復原。確定要清理嗎？`)) return;
      } catch (e: any) {
        setError(e.message);
        return;
      }
    }
    setBusy(name);
    setError(null);
    setMessage(null);
    try {
      const j = await call('POST', { action: name });
      if (name === 'prune') setMessage(`已刪除 ${j.removed} 份舊備份，釋放約 ${j.freedMB} MB。${j.errors?.length ? '部分失敗：' + j.errors.join('；') : ''}`);
      else setMessage(`${label}完成。`);
      await load();
    } catch (e: any) {
      setError(`${label}失敗：${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  const snap = report?.metrics.snapshot;
  const limits = report?.metrics.limits;

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 12, lineHeight: 1.7 }}>
        每天排程會自動檢查一次（驗證最新備份、資料庫與儲存空間用量、連線數等），有問題會寄信給系統管理員 S（需設定寄信，見維運手冊）。這裡可以隨時手動檢查。
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => action('check', '檢查')} disabled={!!busy} style={{ padding: '6px 14px' }}>
          {busy === 'check' ? '檢查中…' : '立即檢查'}
        </button>
        <button onClick={() => action('verify', '備份驗證')} disabled={!!busy} style={{ padding: '6px 14px' }} title="讀回最新備份的所有檔案，比對列數與資料關聯，約 10～30 秒">
          {busy === 'verify' ? '驗證中（約 10～30 秒）…' : '驗證最新備份'}
        </button>
        <button onClick={() => action('prune', '清理')} disabled={!!busy} style={{ padding: '6px 14px' }} title="只有系統管理員 S 可以執行">
          {busy === 'prune' ? '清理中…' : '清理舊備份'}
        </button>
      </div>

      {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
      {message && <p style={{ color: '#3B6D11', fontSize: 13 }}>{message}</p>}
      {!report && busy === 'load' && <p style={{ fontSize: 13, color: 'var(--sub)' }}>檢查中…</p>}

      {report && (
        <>
          <p style={{ fontSize: 15, margin: '8px 0', color: STATUS_COLOR[report.status], fontWeight: 700 }}>
            目前狀態：{STATUS_LABEL[report.status]}
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--sub)', marginLeft: 8 }}>{new Date(report.checkedAt).toLocaleString()}</span>
          </p>
          {report.alerts.length > 0 ? (
            <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, margin: '0 0 12px' }}>
              {report.alerts.map((a) => (
                <li key={a.key} style={{ color: STATUS_COLOR[a.level] }}>
                  【{STATUS_LABEL[a.level]}】{a.message}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--sub)', margin: '0 0 12px' }}>沒有發現問題。</p>
          )}

          {snap && limits && (
            <table style={{ fontSize: 13, borderCollapse: 'collapse', marginBottom: 12 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '3px 12px 3px 0' }}>儲存空間</td>
                  <td><Bar used={snap.storage_bytes} limit={limits.storageBytes} />{Math.round(snap.storage_bytes / MB)} / {Math.round(limits.storageBytes / MB)} MB（備份 {Math.round(snap.backup_storage_bytes / MB)} MB）</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 12px 3px 0' }}>資料庫大小</td>
                  <td><Bar used={snap.db_bytes} limit={limits.dbBytes} />{Math.round(snap.db_bytes / MB)} / {Math.round(limits.dbBytes / MB)} MB</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 12px 3px 0' }}>資料庫連線</td>
                  <td><Bar used={snap.conns} limit={snap.max_conns} />{snap.conns} / {snap.max_conns}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 12px 3px 0' }}>資料庫回應</td>
                  <td>{report.metrics.pingMs === null ? '連不上' : `${Math.round(report.metrics.pingMs)} 毫秒`}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 12px 3px 0' }}>最新備份</td>
                  <td>{report.metrics.latestBackup ? `${Math.round(report.metrics.latestBackup.ageHours * 10) / 10} 小時前（${report.metrics.latestBackup.totalRows.toLocaleString()} 列）` : '沒有備份'}</td>
                </tr>
                {report.metrics.prune && (
                  <tr>
                    <td style={{ padding: '3px 12px 3px 0' }}>可清理的舊備份</td>
                    <td>{report.metrics.prune.removeCount} 份（約 {report.metrics.prune.freeMB} MB）——依保留規則：最近 10 天每天一份，之後每週一份（6 週），再之後每月一份（4 個月）</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {snap?.slow_queries?.length > 0 && (
            <details style={{ fontSize: 12, marginBottom: 12 }}>
              <summary style={{ cursor: 'pointer' }}>較慢的查詢（資料庫累計統計，平均超過 0.5 秒，最多 5 筆）</summary>
              <ul style={{ paddingLeft: 18, lineHeight: 1.7 }}>
                {snap.slow_queries.map((q: any, i: number) => (
                  <li key={i}>
                    平均 {q.mean_ms} 毫秒、最慢 {q.max_ms} 毫秒、共 {q.calls} 次：<code style={{ wordBreak: 'break-all' }}>{q.q}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <h3 style={{ fontSize: 13, margin: '16px 0 6px' }}>最近一次備份驗證</h3>
      {lastVerify ? (
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <span style={{ color: lastVerify.ok ? STATUS_COLOR.ok : STATUS_COLOR.critical, fontWeight: 700 }}>{lastVerify.ok ? '✅ 通過' : '❌ 未通過'}</span>
          ：備份時間 {lastVerify.createdAt ? new Date(lastVerify.createdAt).toLocaleString() : '—'}，檢查了 {lastVerify.tablesChecked} 張表、{lastVerify.totalRows.toLocaleString()} 列，花 {Math.round(lastVerify.durationMs / 1000)} 秒。
          {lastVerify.problems.length > 0 && (
            <ul style={{ color: STATUS_COLOR.critical, paddingLeft: 18, margin: '4px 0' }}>{lastVerify.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          )}
          {lastVerify.warnings.length > 0 && (
            <ul style={{ color: STATUS_COLOR.warning, paddingLeft: 18, margin: '4px 0' }}>{lastVerify.warnings.map((p, i) => <li key={i}>{p}</li>)}</ul>
          )}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--sub)' }}>還沒有驗證紀錄（每天排程會自動驗證一次，也可以按上面的「驗證最新備份」）。</p>
      )}

      <h3 style={{ fontSize: 13, margin: '16px 0 6px' }}>檢查紀錄（最近 30 次）</h3>
      {history.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--sub)' }}>還沒有紀錄。</p>
      ) : (
        <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--sub)' }}>
              <th style={{ padding: 4 }}>時間</th>
              <th style={{ padding: 4 }}>來源</th>
              <th style={{ padding: 4 }}>狀態</th>
              <th style={{ padding: 4 }}>問題</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: 4, whiteSpace: 'nowrap' }}>{new Date(h.checked_at).toLocaleString()}</td>
                <td style={{ padding: 4 }}>{h.source === 'cron' ? '每日排程' : '手動'}</td>
                <td style={{ padding: 4, color: STATUS_COLOR[h.status], fontWeight: 700 }}>{STATUS_LABEL[h.status]}</td>
                <td style={{ padding: 4 }}>{h.alerts.map((a) => a.message).join('；') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

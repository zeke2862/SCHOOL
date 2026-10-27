'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Status = {
  config: { configured: boolean; method: 'smtp' | 'resend' | null; from: string };
  pending: number;
  recent: { id: string; to_name: string; subject: string; created_at: string; sent_at: string | null; error: string | null }[];
};

// 通知信的狀態：寄信有沒有設定好、還有幾封待寄、最近寄了哪些。寄信服務的帳號密碼／金鑰
// 只放在 Vercel 的環境變數，這個頁面不會顯示也不能修改。
export default function EmailSettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function headers() {
    const { data } = await supabase.auth.getSession();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` };
  }
  async function load() {
    setError('');
    const res = await fetch('/api/admin/email-status', { headers: await headers() });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return setError(b.error ?? '讀取失敗');
    setStatus(b as Status);
  }
  useEffect(() => {
    load();
  }, []);

  async function act(action: 'test' | 'flush') {
    setBusy(true);
    setMsg('');
    setError('');
    const res = await fetch('/api/admin/email-status', { method: 'POST', headers: await headers(), body: JSON.stringify({ action }) });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(b.error ?? '失敗');
    setMsg(
      action === 'test'
        ? `測試信已寄到 ${b.to}，請到信箱確認（也看一下垃圾郵件匣）。`
        : b.notConfigured
          ? '寄信尚未設定好，沒有寄出。'
          : `已處理：寄出 ${b.sent} 封、失敗 ${b.failed} 封、略過 ${b.skipped} 封。`
    );
    load();
  }

  const cfg = status?.config;
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>寄信設定</h1>
      <p style={{ fontSize: 13, color: '#666', lineHeight: 1.7, marginBottom: 16 }}>
        系統有新的通知（家長／學生帳號申請、考場名冊、審核、出缺勤示警…）時，會寄一封簡短的信到老師的登入信箱，提醒他登入處理。
        信裡只寫通知類別，不含學生姓名、電話等個資。老師可以在「帳號設定」自己關閉。
      </p>
      {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#3B6D11', fontSize: 13 }}>{msg}</p>}
      {!status && !error && <p style={{ fontSize: 13, color: '#999' }}>載入中…</p>}

      {cfg && (
        <section style={{ border: '1px solid #e5e5e0', borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>
            寄信服務：
            {cfg.configured ? (
              <b style={{ color: '#3B6D11' }}>已設定（{cfg.method === 'smtp' ? 'SMTP' : 'Resend'}，寄件人 {cfg.from}）</b>
            ) : (
              <b style={{ color: '#A32D2D' }}>尚未設定</b>
            )}
          </div>
          {!cfg.configured && (
            <div style={{ fontSize: 12.5, color: '#666', lineHeight: 1.8 }}>
              請到 Vercel 專案的 Settings → Environment Variables 新增（只勾 Production），存檔後 Redeploy：
              <ul style={{ margin: '6px 0 0 18px' }}>
                <li>
                  用 Gmail 或學校信箱（SMTP）：<code>SMTP_HOST</code>、<code>SMTP_PORT</code>（465）、<code>SMTP_USER</code>、<code>SMTP_PASS</code>（Gmail 要用「應用程式密碼」）、<code>MAIL_FROM</code>
                </li>
                <li>
                  或用 Resend：<code>RESEND_API_KEY</code>、<code>MAIL_FROM</code>（要在 Resend 驗證過的寄件網域）
                </li>
                <li>
                  選填：<code>SITE_URL</code>（信裡附的系統網址）
                </li>
              </ul>
            </div>
          )}
          <div style={{ fontSize: 13, marginTop: 10 }}>待寄信件：{status?.pending ?? 0} 封（超過 3 天沒寄出的會直接略過）</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button disabled={busy || !cfg.configured} onClick={() => act('test')} style={{ padding: '8px 14px', borderRadius: 6 }}>
              寄測試信給我
            </button>
            <button disabled={busy || !cfg.configured} onClick={() => act('flush')} style={{ padding: '8px 14px', borderRadius: 6 }}>
              立即寄出待寄信件
            </button>
            <button disabled={busy} onClick={load} style={{ padding: '8px 14px', borderRadius: 6 }}>
              重新整理
            </button>
          </div>
        </section>
      )}

      {status && (
        <section>
          <h2 style={{ fontSize: 14, marginBottom: 6 }}>最近 30 封</h2>
          {status.recent.length === 0 ? (
            <p style={{ fontSize: 13, color: '#999' }}>還沒有信件紀錄。</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', background: '#f5f5f3' }}>
                  <th style={{ padding: 6 }}>時間</th>
                  <th style={{ padding: 6 }}>收件人</th>
                  <th style={{ padding: 6 }}>主旨</th>
                  <th style={{ padding: 6 }}>狀態</th>
                </tr>
              </thead>
              <tbody>
                {status.recent.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid #eee', verticalAlign: 'top' }}>
                    <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString('zh-TW', { hour12: false })}</td>
                    <td style={{ padding: 6 }}>{r.to_name}</td>
                    <td style={{ padding: 6 }}>{r.subject}</td>
                    <td style={{ padding: 6, color: r.sent_at && !r.error ? '#3B6D11' : r.error ? '#A32D2D' : '#A36A00' }}>
                      {r.sent_at && !r.error ? '已寄出' : r.error ? r.error : '待寄'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}

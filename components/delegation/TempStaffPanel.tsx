'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Item = { id: string; name: string; email: string | null; home_org: string | null; account_expires_at: string | null };

export default function TempStaffPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [f, setF] = useState({ name: '', email: '', homeOrg: '', expiresOn: '', password: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (method: string, body?: any) => {
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/temp-staff', {
      method,
      headers: { Authorization: `Bearer ${data.session?.access_token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || '失敗');
    return j;
  }, []);
  const load = useCallback(async () => {
    try { setItems((await call('GET')).items); } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  }, [call]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setBusy(true); setMsg(null);
    try {
      await call('POST', { ...f, password: f.password || undefined });
      setMsg({ ok: true, text: f.password ? '建立完成，請把信箱與密碼交給老師（第一次登入需改密碼）。' : '已寄出邀請信，老師點信中連結即可設定密碼。' });
      setF({ name: '', email: '', homeOrg: '', expiresOn: '', password: '' });
      await load();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  }
  async function patch(id: string, expiresOn: string, okText: string) {
    setBusy(true); setMsg(null);
    try { await call('PATCH', { id, expiresOn }); setMsg({ ok: true, text: okText }); await load(); } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  }

  const inp: React.CSSProperties = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, width: '100%' };
  const box: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 };
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>臨時教師（外校支援）</h2>
      <p style={{ color: '#64748b' }}>幫外校來支援的老師開一個「有期限」的帳號：身分是任課教師，到期日一過權限自動失效、也無法登入。建好之後，他就能被選為代理人。</p>
      {msg && <div style={{ ...box, background: msg.ok ? '#ecfdf5' : '#fef2f2' }}>{msg.text}</div>}
      <div style={box}>
        <b>新增臨時教師</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 8 }}>
          <input style={inp} placeholder="姓名" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input style={inp} placeholder="電子信箱" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input style={inp} placeholder="所屬學校／單位" value={f.homeOrg} onChange={(e) => setF({ ...f, homeOrg: e.target.value })} />
          <input style={inp} type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} title="到期日" />
          <input style={inp} placeholder="臨時密碼（留空＝寄邀請信）" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </div>
        <button disabled={busy} onClick={add} style={{ marginTop: 12, padding: '8px 18px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 8 }}>建立</button>
      </div>
      <div style={box}>
        <b>目前的臨時教師</b>
        {items.length === 0 && <p style={{ color: '#94a3b8' }}>還沒有。</p>}
        {items.map((u) => {
          const expired = u.account_expires_at && new Date(u.account_expires_at) <= new Date();
          return (
            <div key={u.id} style={{ borderTop: '1px solid #f1f5f9', padding: '10px 0' }}>
              <b>{u.name}</b>（{u.home_org || '—'}）{u.email}
              <span style={{ marginLeft: 8, fontSize: 12, color: expired ? '#b91c1c' : '#15803d' }}>
                {expired ? '已到期' : '有效至 ' + (u.account_expires_at ? new Date(u.account_expires_at).toLocaleDateString('zh-TW') : '—')}
              </span>
              <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" id={`ext-${u.id}`} style={{ padding: 4 }} />
                <button disabled={busy} onClick={() => { const v = (document.getElementById(`ext-${u.id}`) as HTMLInputElement).value; if (v) patch(u.id, v, '已更新到期日'); }}>延長／改到期日</button>
                {!expired && <button disabled={busy} style={{ color: '#b91c1c' }} onClick={() => { if (confirm('確定立即停用這個帳號？')) patch(u.id, 'now', '已停用'); }}>立即停用</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

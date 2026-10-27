'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// 對應反映事項「請增加教師及管理者信箱更換功能」：任何已登入的教職員（不限管理員）
// 都可以在這裡自己更換登入信箱，不用麻煩管理員代為操作。
export default function AccountSettingsPage() {
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // 通知信開關
  const [mailPref, setMailPref] = useState<boolean | null>(null);
  const [mailPrefStaff, setMailPrefStaff] = useState(false);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ''}` };
  }
  async function toggleMailPref(next: boolean) {
    setMailPref(next);
    const res = await fetch('/api/account/email-pref', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) setMailPref(!next);
  }

  // 更改密碼
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwOk(false);
    if (newPw.length < 6) return setPwError('新密碼至少要6個字元');
    if (newPw !== newPw2) return setPwError('兩次輸入的新密碼不一致');
    setPwBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) return setPwError('請重新登入');
      const res = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ currentPassword: oldPw, newPassword: newPw }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setPwError(body.error ?? '更改失敗');
      setOldPw('');
      setNewPw('');
      setNewPw2('');
      setPwOk(true);
    } finally {
      setPwBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setCurrentEmail(data.user?.email ?? null);
      try {
        const res = await fetch('/api/account/email-pref', { headers: await authHeader() });
        const b = await res.json();
        if (res.ok) {
          setMailPref(!!b.enabled);
          setMailPrefStaff(!!b.isStaff);
        }
      } catch {
        /* 讀不到就不顯示這個開關 */
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setError('請重新登入');
        return;
      }
      const res = await fetch('/api/account/update-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ newEmail, currentPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? '更換失敗');
        return;
      }
      setCurrentEmail(newEmail.trim());
      setNewEmail('');
      setCurrentPassword('');
      setSuccess(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>帳號設定</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 20 }}>目前登入信箱：{currentEmail ?? '載入中…'}</p>

      <h2 style={{ fontSize: 14, marginBottom: 8 }}>更換登入信箱</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          type="email"
          placeholder="新信箱"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          required
        />
        <input
          type="password"
          placeholder="目前密碼（確認身分用）"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          required
        />
        {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
        {success && <p style={{ color: '#3B6D11', fontSize: 13 }}>信箱已更換，請記得下次改用新信箱登入。</p>}
        <button
          type="submit"
          disabled={submitting}
          style={{ padding: 12, background: submitting ? '#999' : '#2C2C2A', color: '#fff', border: 'none', borderRadius: 8 }}
        >
          {submitting ? '更換中…' : '更換信箱'}
        </button>
      </form>

      {mailPrefStaff && mailPref !== null && (
        <>
          <h2 style={{ fontSize: 14, margin: '28px 0 8px' }}>通知信</h2>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.6 }}>
            <input type="checkbox" checked={mailPref} onChange={(e) => toggleMailPref(e.target.checked)} style={{ marginTop: 4 }} />
            <span>
              有新的待處理通知（例如家長／學生帳號申請、考場名冊、審核）時，寄信到登入信箱提醒我。
              <br />
              <span style={{ color: '#888' }}>信裡只寫通知類別，不含學生個資，詳細內容要登入系統查看。</span>
            </span>
          </label>
        </>
      )}

      <h2 style={{ fontSize: 14, margin: '28px 0 8px' }}>更改密碼</h2>
      <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          type="password"
          placeholder="目前密碼"
          value={oldPw}
          onChange={(e) => setOldPw(e.target.value)}
          autoComplete="current-password"
          style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          required
        />
        <input
          type="password"
          placeholder="新密碼（至少6碼）"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          autoComplete="new-password"
          style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          required
        />
        <input
          type="password"
          placeholder="再輸入一次新密碼"
          value={newPw2}
          onChange={(e) => setNewPw2(e.target.value)}
          autoComplete="new-password"
          style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          required
        />
        {pwError && <p style={{ color: '#A32D2D', fontSize: 13 }}>{pwError}</p>}
        {pwOk && <p style={{ color: '#3B6D11', fontSize: 13 }}>密碼已更改，下次登入請使用新密碼。</p>}
        <button
          type="submit"
          disabled={pwBusy}
          style={{ padding: 12, background: pwBusy ? '#999' : '#2C2C2A', color: '#fff', border: 'none', borderRadius: 8 }}
        >
          {pwBusy ? '更改中…' : '更改密碼'}
        </button>
      </form>
    </main>
  );
}

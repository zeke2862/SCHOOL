'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { isWeakPassword } from '@/lib/weakPasswords';

// 對應反映事項「開發人員處增加【第一次登入強制更改密碼】功能」：開關開啟時，
// 新建立的教職員帳號會被標記 must_change_password=true（見
// app/api/admin/invite-user/route.ts），app/(app)/layout.tsx 會攔截所有教職員頁面、
// 導來這裡，改完密碼才能繼續使用系統。
export default function ChangePasswordPage() {
  const [checking, setChecking] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 從「忘記密碼」信裡的連結進來（網址帶 ?recovery=1）：說明文字不同，其餘流程一樣
  const [recovery, setRecovery] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const isRecovery = new URLSearchParams(window.location.search).get('recovery') === '1';
      const hash = window.location.hash;
      setRecovery(isRecovery);
      // 連結過期或已經用過：不要默默跳回登入頁，直接告訴使用者怎麼辦
      if (/error_code=|error=access_denied/.test(hash)) {
        setLinkError(true);
        setChecking(false);
        return;
      }
      // getSession 會等信裡連結帶來的憑證處理完才回傳
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (isRecovery) {
          setLinkError(true);
          setChecking(false);
          return;
        }
        router.replace('/');
        return;
      }
      setChecking(false);
    })();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError('密碼至少要6個字元');
      return;
    }
    if (isWeakPassword(newPassword)) {
      setError('這組密碼太常見，請設定其他密碼');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('兩次輸入的密碼不一致');
      return;
    }
    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setError('請重新登入');
        return;
      }
      const res = await fetch('/api/account/complete-password-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? '更新失敗');
        return;
      }
      // 賽事訪客改完密碼直接進競賽活動；其他人照舊進管理首頁
      const { data: me } = await supabase.from('app_users').select('role').eq('id', sessionData.session!.user.id).maybeSingle();
      router.push(me?.role === 'competition_guest' ? '/competitions' : '/admin');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) return <main style={{ padding: 24 }}>載入中…</main>;

  if (linkError) {
    return (
      <main style={{ maxWidth: 360, margin: '80px auto', padding: 24 }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>重設密碼連結已失效</h1>
        <p style={{ fontSize: 14, color: 'var(--sub)', marginBottom: 20, lineHeight: 1.7 }}>
          這個連結已經過期或用過了（每個連結只能用一次、一小時內有效）。請回登入頁按「忘記密碼？」重新寄送，或請系統管理員協助重設。
        </p>
        <button type="button" onClick={() => router.replace('/')} style={{ padding: 12, width: '100%', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8 }}>
          回登入頁
        </button>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 360, margin: '80px auto', padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>{recovery ? '重設密碼' : '請先設定新密碼'}</h1>
      <p style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 24 }}>
        {recovery
          ? '請輸入一組新密碼。更新後會直接登入系統，之後請用新密碼登入。'
          : '這是您第一次登入（或密碼剛被管理員重設），系統要求先自己設定一組新密碼，才能繼續使用。'}
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          type="password"
          placeholder="新密碼（至少6碼）"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: '1px solid var(--line-strong)' }}
          required
        />
        <input
          type="password"
          placeholder="再輸入一次新密碼"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: '1px solid var(--line-strong)' }}
          required
        />
        {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          style={{ padding: 12, background: submitting ? '#999' : 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8 }}
        >
          {submitting ? '更新中…' : '更新密碼並繼續'}
        </button>
      </form>
    </main>
  );
}

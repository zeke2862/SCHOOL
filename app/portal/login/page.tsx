'use client';

export const dynamic = 'force-dynamic';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

// 【2026-08-28 改版】家長／學生查詢入口改用「登入代碼＋手機號碼」一步登入，不再
// 需要信箱／驗證信這一段：手機號碼直接跟學籍資料/監護人資料裡登記的電話比對
// （見 app/api/portal/request-login/route.ts），核對成功就直接拿到登入 session，
// 不用再多一步「先收信、點連結、回來才輸入代碼綁定」。
function PortalLoginPageInner() {
  const [loginCode, setLoginCode] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      const codeFromUrl = searchParams.get('code');
      if (!session) {
        setChecking(false);
        if (codeFromUrl) setLoginCode(codeFromUrl);
        return;
      }

      // 反映事項「學生登入以後首頁是教師版」的防護：如果這台裝置/瀏覽器剛好還留著
      // 教職員沒登出的 session，不要把它當成這次家長/學生登入的身分，先登出、當作
      // 「還沒登入」處理，讓真正要查詢的人從乾淨的狀態重新輸入登入代碼與手機號碼。
      const { data: staffRow } = await supabase.from('app_users').select('id').eq('id', session.user.id).maybeSingle();
      if (staffRow) {
        await supabase.auth.signOut();
        setChecking(false);
        if (codeFromUrl) setLoginCode(codeFromUrl);
        return;
      }

      // 已經有登入中的家長/學生 session（例如之前登入過沒登出），且這次不是要
      // 綁定新的代碼（網址沒帶 code），就直接進查詢頁；否則留在這頁讓他繼續操作
      // （例如要換一個小孩的代碼查詢）。
      if (!codeFromUrl) {
        const { data: existing } = await supabase.from('portal_accounts').select('id').eq('auth_user_id', session.user.id).limit(1);
        if (existing && existing.length > 0) {
          router.push('/portal');
          return;
        }
      }
      if (codeFromUrl) setLoginCode(codeFromUrl);
      setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 第一次使用：把代碼＋手機送給班導師審核（導師核對後核准，手機會自動記進學籍資料）
  async function handleRegister() {
    setError(null);
    setNotice(null);
    if (!loginCode.trim() || !phone.trim()) {
      setError('請先輸入登入代碼與手機號碼');
      return;
    }
    setRegistering(true);
    try {
      const res = await fetch('/api/portal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginCode, phone }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? '送出申請失敗');
      else setNotice(body.message ?? '申請已送出');
    } finally {
      setRegistering(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/portal/request-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginCode, phone }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? '登入失敗');
        return;
      }
      const { error: setErr } = await supabase.auth.setSession({
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
      });
      if (setErr) {
        setError('登入失敗：' + setErr.message);
        return;
      }
      router.push('/portal');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) return <main style={{ padding: 24 }}>載入中…</main>;

  return (
    <main style={{ maxWidth: 360, margin: '80px auto', padding: 24 }}>
      <button
        onClick={() => router.push('/')}
        style={{ background: 'none', border: 'none', color: '#999', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 16 }}
      >
        ‹ 返回選擇身分
      </button>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>家長／學生查詢入口</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 24 }}>
        家長帳號是 <b>HY＋學號</b>，學生帳號是 <b>HYS＋學號</b>，密碼是<b>你的手機號碼</b>。
        <br />
        <b>第一次使用</b>請輸入後按「第一次使用？申請帳號」，申請會送給班導師核對手機號碼，核准後就能登入；之後直接按「登入」即可。查詢。
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          placeholder="登入代碼（例如 HY0123）"
          value={loginCode}
          onChange={(e) => setLoginCode(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          required
        />
        <input
          type="tel"
          placeholder="手機號碼"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          required
        />
        {error && <p style={{ color: '#A32D2D', fontSize: 14 }}>{error}</p>}
        {notice && <p style={{ color: '#3B6D11', fontSize: 14, background: '#EAF3EC', borderRadius: 8, padding: 10 }}>{notice}</p>}
        <button type="submit" disabled={submitting} style={{ padding: 12, background: submitting ? '#999' : '#2C2C2A', color: '#fff', border: 'none', borderRadius: 8 }}>
          {submitting ? '登入中…' : '登入'}
        </button>
        <button type="button" onClick={handleRegister} disabled={registering} style={{ padding: 12, background: '#fff', color: '#2C6E9E', border: '1px solid #2C6E9E', borderRadius: 8 }}>
          {registering ? '送出中…' : '第一次使用？申請帳號'}
        </button>
        <p style={{ fontSize: 13, color: '#999' }}>登入時如果顯示「代碼與手機不相符」，代表這支手機還沒登記，請按上面的「申請帳號」，等班導師核准。</p>
      </form>
    </main>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <PortalLoginPageInner />
    </Suspense>
  );
}

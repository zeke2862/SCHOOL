'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isWeakPassword, validateNewPassword } from '@/lib/weakPasswords';
import { supabase, getCurrentAppUser, getMyIdentity, resetIdentityCache } from '@/lib/supabaseClient';
import { BulletinPost, getPublishedPosts } from '@/lib/bulletin';
import ThemeSwitch from '@/components/ThemeSwitch';
import { canUseTeacherView } from '@/lib/permissions';
import { getGameMode } from '@/lib/gameMode';
import { MFA_ROLES, getMfaStatus, verifyMfaCode } from '@/lib/mfa';
import TurnstileWidget, { TURNSTILE_SITE_KEY, type TurnstileHandle } from '@/components/TurnstileWidget';

type CardKey = 'staff' | 'parent';

const CARDS: { key: CardKey; title: string; desc: string; emoji: string }[] = [
  { key: 'staff', title: '教職員', desc: '老師、主任、行政人員（登入後依您的身分顯示功能）', emoji: '🍎' },
  { key: 'parent', title: '家長/學生登入口', desc: '查詢孩子的成績與出缺席紀錄', emoji: '👪' },
];

// 首頁登入卡片上方的「公佈欄」：最新一篇用縮圖凸顯，接下來幾篇只列標題。
// 這裡刻意在還沒登入的頁面就顯示，讓還沒登入的人也能先看到學校最新消息。
function BulletinBoard() {
  const [posts, setPosts] = useState<BulletinPost[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    getPublishedPosts(5).then(setPosts);
  }, []);

  if (!posts || posts.length === 0) return null;

  const [latest, ...rest] = posts;
  const expandedPost = posts.find((p) => p.id === expandedId) ?? null;

  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 13, color: '#999', marginBottom: 10 }}>公佈欄</h2>
      <button
        onClick={() => setExpandedId(expandedId === latest.id ? null : latest.id)}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          padding: 0,
          border: '1px solid #e5e2da',
          borderRadius: 12,
          background: '#fff',
          cursor: 'pointer',
          overflow: 'hidden',
          marginBottom: 10,
        }}
      >
        {latest.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={latest.thumbnail_url} alt={latest.title} style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }} />
        )}
        <div style={{ padding: '10px 14px' }}>
          <span style={{ display: 'block', fontSize: 14, color: '#2C2C2A' }}>{latest.title}</span>
        </div>
      </button>
      {rest.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rest.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                style={{ background: 'none', border: 'none', padding: '4px 0', fontSize: 12, color: '#666', cursor: 'pointer', textAlign: 'left' }}
              >
                ・{p.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {expandedPost && (
        <div style={{ marginTop: 10, padding: 12, border: '1px solid #eee', borderRadius: 8, fontSize: 13, color: '#444', whiteSpace: 'pre-wrap' }}>
          {expandedPost.content}
        </div>
      )}
    </div>
  );
}

// 「忘記密碼」信裡的連結點回來時，網址後面會帶 #...type=recovery（或 #error=...）。
// 登入套件處理完就會把它清掉，所以在頁面程式一載入時先記下來。
const INITIAL_HASH = typeof window !== 'undefined' ? window.location.hash : '';

export default function LoginPage() {
  const [card, setCard] = useState<CardKey | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  // 忘記密碼（驗證碼）：信裡的驗證碼、新密碼
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  // 用驗證碼改密碼時，登入套件也會發出「密碼重設」事件；這時不要被下面的 useEffect 帶去另一頁
  const codeFlow = useRef(false);
  // 雙重驗證第二步：密碼通過後，帳號有登記驗證器就停在這裡要 6 位數字碼
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaWeak, setMfaWeak] = useState(false); // 這次是不是用已公開的預設密碼登入（驗證通過後才標記要改密碼）
  // 人機驗證（有設定 Turnstile 才會用到）
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const router = useRouter();

  // 忘記密碼：使用者點了信裡的連結回到這裡 → 直接帶去「設定新密碼」頁，不用再登入一次。
  // 連結過期或已經用過，就打開忘記密碼表單請他重寄。
  useEffect(() => {
    if (/error_code=otp_expired|error=access_denied/.test(INITIAL_HASH)) {
      setCard('staff');
      setForgotMode(true);
      setError('這個重設密碼連結已經失效或用過了，請重新寄送一次。');
      try {
        window.history.replaceState(null, '', window.location.pathname);
      } catch {}
      return;
    }
    const go = () => router.replace('/change-password?recovery=1');
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !codeFlow.current) go();
    });
    if (/type=recovery/.test(INITIAL_HASH)) {
      // getSession 會等連結裡的憑證處理完；有登入狀態就代表連結有效
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) go();
      });
    }
    return () => sub.subscription.unsubscribe();
  }, [router]);

  function chooseCard(key: CardKey) {
    setError(null);
    if (key === 'parent') {
      // 家長／學生查詢入口用的是「登入代碼＋手機號碼」機制（不是密碼），
      // 沿用既有的 /portal/login 頁面，避免另外做一套不安全的假密碼欄位。
      router.push('/portal/login');
      return;
    }
    setCard(key);
  }

  function backToCards() {
    setCard(null);
    setError(null);
    setForgotMode(false);
    setForgotSent(false);
    setPassword('');
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email) {
      setError('請先輸入電子郵件');
      return;
    }
    // 點信裡的連結後直接到「設定新密碼」頁；若該網址沒有列在登入服務的允許清單，
    // 會退回系統首頁，首頁（上面的 useEffect）一樣會把人帶去設定新密碼。
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError('請先完成下方的人機驗證');
      return;
    }
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/change-password?recovery=1`,
      captchaToken: captchaToken ?? undefined,
    });
    turnstileRef.current?.reset(); // 驗證結果只能用一次
    if (resetErr) {
      setError('寄送重設密碼信失敗：' + resetErr.message);
      return;
    }
    setForgotSent(true);
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
    setResendAt(Date.now() + 60_000);
  }

  // 忘記密碼第二步：輸入信裡的驗證碼＋新密碼，驗證通過就直接改好並登入
  async function handleCodeReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const token = code.replace(/\D/g, '');
    if (token.length < 6) return setError('請輸入信裡的驗證碼（6 位數字）');
    const weakReason = validateNewPassword(newPassword);
    if (weakReason) return setError(weakReason);
    if (newPassword !== confirmPassword) return setError('兩次輸入的密碼不一致');
    setBusy(true);
    codeFlow.current = true;
    try {
      const { data, error: otpErr } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'recovery' });
      if (otpErr || !data.session) {
        setError('驗證碼不正確或已過期（每組驗證碼只能用一次、一小時內有效）。請確認是最新一封信裡的驗證碼，或重新寄送。');
        return;
      }
      const res = await fetch('/api/account/complete-password-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 驗證碼已經用掉、也已經登入了，只是密碼沒改成：帶去「重設密碼」頁再試一次，不用重寄驗證碼
        setError((body.error ?? '更新密碼失敗') + '。即將帶您到重設密碼畫面再試一次…');
        setTimeout(() => router.replace('/change-password?recovery=1'), 1800);
        return;
      }
      await finishSignIn(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError('請先完成下方的人機驗證');
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    turnstileRef.current?.reset(); // 驗證結果只能用一次，失敗要重新驗證
    if (signInError) {
      setError(/captcha/i.test(signInError.message) ? '人機驗證未通過，請重新驗證後再登入' : '帳號或密碼錯誤');
      return;
    }

    await finishSignIn(isWeakPassword(password));
  }

  // 密碼（或驗證碼改密碼）通過之後：帳號有登記雙重驗證就先停在第二步，沒有就直接進系統
  async function finishSignIn(weakLogin: boolean) {
    const st = await getMfaStatus();
    if (st.needsChallenge && st.factorId) {
      setMfaFactorId(st.factorId);
      setMfaWeak(weakLogin);
      setMfaCode('');
      return;
    }
    await completeLogin(weakLogin);
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!mfaFactorId) return;
    setBusy(true);
    try {
      const err = await verifyMfaCode(mfaFactorId, mfaCode);
      if (err) {
        setError(err);
        setMfaCode('');
        return;
      }
      setMfaFactorId(null);
      await completeLogin(mfaWeak);
    } finally {
      setBusy(false);
    }
  }

  async function cancelMfa() {
    await supabase.auth.signOut();
    setMfaFactorId(null);
    setMfaCode('');
    setPassword('');
    setError(null);
  }

  async function completeLogin(weakLogin: boolean) {
    // 用已公開的預設密碼登入的教職員：標記成下次一定要改密碼（layout 會擋在 /change-password）
    if (weakLogin) {
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;
      if (accessToken) {
        await fetch('/api/account/flag-weak-password', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {});
      }
    }
    await enterSystem();
  }

  // 登入成功之後決定要去哪一頁（一般登入、用驗證碼改完密碼後都走這裡）
  async function enterSystem() {
    // 先清快取再查：getCurrentAppUser 會順便把身分查好放進快取，後面 getMyIdentity 直接用，不用再打一次
    if (typeof window !== 'undefined') sessionStorage.removeItem('viewMode');
    resetIdentityCache();
    const appUser = await getCurrentAppUser();
    if (!appUser) {
      setError('找不到對應的使用者角色資料，請聯絡管理員');
      await supabase.auth.signOut();
      return;
    }

    // 登入頁只分「教職員」與「家長」；進去之後看到什麼，完全由帳號的身分決定（見 lib/permissions.ts）。
    // 不再有「管理者／教師」兩種畫面：主管同時也是老師，所以首頁會同時列出「教學作業」與「行政管理」。
    const ident = await getMyIdentity();
    if (ident?.expired) {
      setError('此帳號已到期，請聯絡教務處');
      await supabase.auth.signOut();
      return;
    }
    // 系統管理員 S／A 還沒登記雙重驗證：帶去帳號設定頁設定（不強制；要強制請設 NEXT_PUBLIC_MFA_REQUIRED=1，見 (app)/layout）
    if (MFA_ROLES.includes(appUser.role as string)) {
      const st = await getMfaStatus();
      if (!st.factorId) {
        router.push('/account?mfa=setup');
        return;
      }
    }
    // 賽事訪客（外聘評審/裁判）→ 直接進競賽活動，不經過校務系統首頁
    if ((appUser.role as string) === 'competition_guest') {
      router.push('/competitions');
      return;
    }
    // 單純的任課／導師（沒有任何行政身分）→ 照「教師登入首頁設定」走；其他人進首頁看全部入口
    // 行政人員平常只做教師工作：本人有導師／任課／社團資格的，登入後預設進「教師畫面（本人身分）」，
    // 要做行政時再從上方「代理／視角」切到完整管理畫面。沒有教師資格的純行政人員維持完整管理畫面。
    if (ident && canUseTeacherView(ident) && (ident.isHomeroom || ident.isTeaching || ident.isClubTeacher)) {
      sessionStorage.setItem('viewMode', 'teacher');
      sessionStorage.removeItem('previewKind');
    }
    const plainTeacher = !!ident && ['subject_teacher', 'homeroom_teacher'].includes(ident.role) && ident.departments.length === 0;
    if (plainTeacher) {
      const { data: settingRow } = await supabase.from('teacher_login_settings').select('home_path').eq('id', true).maybeSingle();
      // 選了 RPG／經營面板的人，登入後直接到有面板的首頁；沒選的照學校設定的登入首頁走
      router.push(getGameMode() !== 'classic' ? '/admin' : settingRow?.home_path || '/admin');
      return;
    }
    router.push('/admin');
  }

  // ---------- 第一步：教職員／家長 ----------
  if (!card) {
    return (
      <main style={{ maxWidth: 460, margin: '80px auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}><ThemeSwitch /></div>
        <h1 style={{ marginBottom: 4, textAlign: 'center', color: 'var(--primary)' }}>校務行政系統</h1>
        <p style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 32, textAlign: 'center' }}>請選擇登入方式</p>
        <BulletinBoard />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {CARDS.map((c) => (
            <button
              key={c.key}
              className="tile"
              onClick={() => chooseCard(c.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '20px 20px',
                borderRadius: 14,
                border: '1px solid var(--line)',
                background: 'var(--surface)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 28 }}>{c.emoji}</span>
              <span>
                <span style={{ display: 'block', fontSize: 16, color: 'var(--ink)' }}>{c.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>{c.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </main>
    );
  }

  // ---------- 第二步：教職員卡片 → 帳號密碼登入 ----------
  const cardInfo = CARDS.find((c) => c.key === card)!;

  // ---------- 雙重驗證第二步 ----------
  if (mfaFactorId) {
    return (
      <main style={{ maxWidth: 360, margin: '80px auto', padding: 24 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>🔐 雙重驗證</h1>
        <p style={{ fontSize: 13, color: '#666', lineHeight: 1.7, marginBottom: 16 }}>
          請打開手機上的驗證器 App（Google Authenticator、Microsoft Authenticator 等），輸入「校務行政系統」目前顯示的 6 位數字。
        </p>
        <form onSubmit={handleMfaSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="6 位數字"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', fontSize: 22, letterSpacing: '0.4em', textAlign: 'center' }}
            required
          />
          {error && <p style={{ color: '#A32D2D', fontSize: 13, margin: 0 }}>{error}</p>}
          <button
            type="submit"
            disabled={busy || mfaCode.length !== 6}
            style={{ padding: 10, borderRadius: 8, background: busy || mfaCode.length !== 6 ? '#999' : 'var(--primary)', color: 'var(--on-primary)', border: 'none' }}
          >
            {busy ? '驗證中…' : '驗證並登入'}
          </button>
        </form>
        <p style={{ fontSize: 12, color: '#666', lineHeight: 1.7, marginTop: 14 }}>
          手機遺失或無法使用驗證器：請聯絡系統管理員協助重設雙重驗證（系統管理員 S 自己無法登入時，需由學校的 Supabase 後台管理者處理）。
        </p>
        <button
          onClick={cancelMfa}
          style={{ marginTop: 8, background: 'none', border: 'none', color: '#666', fontSize: 13, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
        >
          取消並登出
        </button>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 360, margin: '80px auto', padding: 24 }}>
      <button
        onClick={backToCards}
        style={{ background: 'none', border: 'none', color: '#999', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 16 }}
      >
        ‹ 返回選擇身分
      </button>
      <h1 style={{ fontSize: 20, marginBottom: 24 }}>
        {cardInfo.emoji} {cardInfo.title}登入
      </h1>

      {!(forgotMode && forgotSent) && (
        <div style={{ marginBottom: 12 }}>
          <TurnstileWidget ref={turnstileRef} onToken={setCaptchaToken} />
        </div>
      )}

      {!forgotMode ? (
        <>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="email"
              placeholder="帳號（電子郵件）"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
              required
            />
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', width: '100%', boxSizing: 'border-box', paddingRight: 56 }}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#666',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {showPassword ? '隱藏' : '顯示'}
              </button>
            </div>
            {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
            <button
              type="submit"
              style={{ padding: 10, borderRadius: 8, background: 'var(--primary)', color: 'var(--on-primary)', border: 'none' }}
            >
              登入
            </button>
          </form>
          <button
            onClick={() => {
              setForgotMode(true);
              setError(null);
              setForgotSent(false);
            }}
            style={{ marginTop: 16, background: 'none', border: 'none', color: '#666', fontSize: 13, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
          >
            忘記密碼？
          </button>
        </>
      ) : (
        <>
          {forgotSent ? (
            <form onSubmit={handleCodeReset} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 13, color: '#3B6D11', margin: 0, lineHeight: 1.7 }}>
                驗證碼已寄到 <b>{email}</b>。請打開信箱（手機的郵件 App 也可以），把信裡的 6 位數驗證碼填在下面，並設定新密碼。
              </p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="驗證碼（6 位數字）"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', fontSize: 20, letterSpacing: '0.3em', textAlign: 'center' }}
                required
              />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="新密碼（至少10碼）"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                required
              />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="再輸入一次新密碼"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                required
              />
              <label style={{ fontSize: 13, color: '#666', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} /> 顯示密碼
              </label>
              {error && <p style={{ color: '#A32D2D', fontSize: 13, margin: 0 }}>{error}</p>}
              <button type="submit" disabled={busy} style={{ padding: 10, borderRadius: 8, background: busy ? '#999' : 'var(--primary)', color: 'var(--on-primary)', border: 'none' }}>
                {busy ? '處理中…' : '更新密碼並登入'}
              </button>
              <p style={{ fontSize: 12, color: '#666', margin: 0, lineHeight: 1.7 }}>
                沒收到信？請先看垃圾信匣，一分鐘後可以
                <button
                  type="button"
                  className="keep-size"
                  onClick={(e) => (Date.now() < resendAt ? setError('剛寄出不久，請稍等一分鐘再重寄') : handleForgotPassword(e as unknown as React.FormEvent))}
                  style={{ background: 'none', border: 'none', padding: '0 2px', minHeight: 0, color: 'var(--primary-ink)', textDecoration: 'underline', cursor: 'pointer', fontSize: '12px' }}
                >
                  重新寄送
                </button>
                。信裡的連結也一樣可以用。仍然收不到，請聯絡系統管理員協助重設。
              </p>
            </form>
          ) : (
            <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 13, color: '#666' }}>輸入您的登入信箱，我們會寄一組驗證碼給您，在這個畫面輸入驗證碼就能直接設定新密碼；若無法收信，也可以請系統管理員（S/A/B）協助重製密碼。</p>
              <input
                type="email"
                placeholder="帳號（電子郵件）"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                required
              />
              {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>{error}</p>}
              <button
                type="submit"
                style={{ padding: 10, borderRadius: 8, background: 'var(--primary)', color: 'var(--on-primary)', border: 'none' }}
              >
                寄送驗證碼
              </button>
            </form>
          )}
          <button
            onClick={() => {
              setForgotMode(false);
              setError(null);
            }}
            style={{ marginTop: 16, background: 'none', border: 'none', color: '#666', fontSize: 13, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
          >
            返回登入
          </button>
        </>
      )}
    </main>
  );
}

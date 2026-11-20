'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// 帳號設定頁的「雙重驗證」區塊：登記／移除手機上的驗證器 App（TOTP）。
// 登記流程：按「設定」→ 掃 QR（或手動輸入金鑰）→ 輸入 App 顯示的 6 位數字確認 → 完成。
// 移除時 Supabase 要求目前登入已通過雙重驗證（登記過的人登入時本來就會做第二步）。

type Factor = { id: string; friendly_name?: string | null; created_at?: string };

export default function MfaSettings({ highlight }: { highlight?: boolean }) {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function startEnroll() {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      // 先清掉以前「掃了但沒完成確認」的殘留（未驗證的因子不會出現在 listFactors 的 totp 清單，要用 all 才看得到）
      const { data: all } = await supabase.auth.mfa.listFactors();
      for (const f of (all?.all ?? []) as { id: string; status: string }[]) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: err } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `驗證器 ${new Date().toLocaleDateString('zh-TW')}`,
      });
      if (err || !data) {
        setError('無法開始設定：' + (err?.message ?? '未知錯誤'));
        return;
      }
      setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll) return;
    setError(null);
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) return setError('請輸入驗證器 App 上的 6 位數字');
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.factorId, code: token });
      if (err) {
        setError('驗證碼不正確，請看 App 目前顯示的最新數字再試一次（手機時間要正確）');
        return;
      }
      setEnroll(null);
      setDone('雙重驗證已啟用。下次登入密碼通過後，會再要求輸入驗證器上的 6 位數字。');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnroll() {
    if (enroll) await supabase.auth.mfa.unenroll({ factorId: enroll.factorId });
    setEnroll(null);
    setError(null);
  }

  async function remove(f: Factor) {
    if (!window.confirm('確定要關閉雙重驗證嗎？關閉後只靠密碼就能登入，安全性會降低。')) return;
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (err) {
        setError('無法關閉：' + err.message);
        return;
      }
      setDone('已關閉雙重驗證。');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      style={{
        marginTop: 28,
        padding: highlight ? 12 : 0,
        border: highlight ? '2px solid var(--primary)' : 'none',
        borderRadius: 10,
      }}
    >
      <h2 style={{ fontSize: 14, marginBottom: 8 }}>雙重驗證（建議系統管理員啟用）</h2>
      {highlight && (
        <p style={{ fontSize: 13, color: '#A32D2D', lineHeight: 1.7, margin: '0 0 8px' }}>
          您的帳號擁有很高的權限，請先設定雙重驗證，避免密碼外洩時整個系統被他人接管。
        </p>
      )}
      <p style={{ fontSize: 13, color: 'var(--sub)', lineHeight: 1.7, margin: '0 0 10px' }}>
        啟用後，登入時除了密碼，還要輸入手機驗證器 App（Google Authenticator、Microsoft Authenticator 等，免費）上的 6 位數字。
      </p>

      {factors === null ? (
        <p style={{ fontSize: 13, color: 'var(--sub)' }}>載入中…</p>
      ) : enroll ? (
        <form onSubmit={confirmEnroll} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 13, margin: 0, lineHeight: 1.7 }}>
            1. 用手機的驗證器 App 掃描下面的 QR 碼。<br />
            2. 輸入 App 上顯示的 6 位數字，按「確認啟用」。
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="雙重驗證 QR 碼" style={{ width: 180, height: 180, background: '#fff', padding: 6, borderRadius: 8, border: '1px solid var(--line-strong)' }} />
          <details style={{ fontSize: 12, color: 'var(--sub)' }}>
            <summary style={{ cursor: 'pointer' }}>無法掃描？手動輸入金鑰</summary>
            <code style={{ wordBreak: 'break-all', userSelect: 'all' }}>{enroll.secret}</code>
          </details>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6 位數字"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ padding: 10, borderRadius: 8, border: '1px solid var(--line-strong)', fontSize: 20, letterSpacing: '0.3em', textAlign: 'center' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={busy || code.length !== 6} style={{ padding: '8px 16px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6 }}>
              確認啟用
            </button>
            <button type="button" onClick={cancelEnroll} disabled={busy} style={{ padding: '8px 16px' }}>
              取消
            </button>
          </div>
        </form>
      ) : factors.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 13, color: '#3B6D11', margin: 0 }}>✅ 已啟用雙重驗證</p>
          {factors.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span>{f.friendly_name || '驗證器'}</span>
              <button onClick={() => remove(f)} disabled={busy} style={{ fontSize: 12, padding: '2px 8px' }}>
                關閉
              </button>
            </div>
          ))}
        </div>
      ) : (
        <button onClick={startEnroll} disabled={busy} style={{ padding: '8px 16px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6 }}>
          設定雙重驗證
        </button>
      )}

      {error && <p style={{ color: '#A32D2D', fontSize: 13, marginTop: 8 }}>{error}</p>}
      {done && <p style={{ color: '#3B6D11', fontSize: 13, marginTop: 8 }}>{done}</p>}
    </section>
  );
}

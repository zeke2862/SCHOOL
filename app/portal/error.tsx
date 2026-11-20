'use client';

import { useEffect } from 'react';

// 頁面執行中發生沒有預期到的錯誤時，只換掉這一頁的內容（上方導覽列仍在），
// 並提供「重試」，不會整個網站變成白畫面。
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" style={{ maxWidth: 480, margin: '64px auto', padding: '0 16px', textAlign: 'center' }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>這個頁面出了點問題</h2>
      <p style={{ fontSize: 14, color: 'var(--sub)', marginBottom: 20 }}>
        可以先按「重試」；如果一直出現，請回報給系統管理員{error.digest ? `（代碼 ${error.digest}）` : ''}。
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--primary)', background: 'var(--primary)', color: 'var(--on-primary)', cursor: 'pointer' }}
        >
          重試
        </button>
        <a
          href="/"
          style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', textDecoration: 'none' }}
        >
          回首頁
        </a>
      </div>
    </div>
  );
}

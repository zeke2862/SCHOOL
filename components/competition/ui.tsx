'use client';

import { CSSProperties, ReactNode, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// 競賽頁面共用的樣式與小工具（沿用校務系統的簡單 inline style 風格）
export const card: CSSProperties = { border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 16 };
export const inputStyle: CSSProperties = { padding: 6, marginTop: 4, width: '100%', boxSizing: 'border-box' };
export const smallInput: CSSProperties = { padding: 4, boxSizing: 'border-box' };
export const th: CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #ddd', fontSize: 12, whiteSpace: 'nowrap' };
export const td: CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 13, verticalAlign: 'top' };
export const btn: CSSProperties = { padding: '6px 12px', border: '1px solid #bbb', borderRadius: 6, background: '#fff', cursor: 'pointer' };
export const btnPrimary: CSSProperties = { ...btn, background: '#1f4e79', color: '#fff', borderColor: '#1f4e79' };
export const btnDanger: CSSProperties = { ...btn, color: '#A32D2D', borderColor: '#d9a3a3' };
export const hint: CSSProperties = { fontSize: 12, color: '#666' };

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} style={card}>
      <h2 style={{ fontSize: 14, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

/** 畫面上方的成功/錯誤訊息 */
export function useFlash() {
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const ok = (text: string) => setFlash({ type: 'ok', text });
  const err = (text: string) => setFlash({ type: 'err', text });
  const node = flash ? (
    <p role="status" style={{ fontSize: 13, margin: '0 0 12px', padding: '8px 10px', borderRadius: 6, background: flash.type === 'ok' ? '#eaf5ea' : '#fbeaea', color: flash.type === 'ok' ? '#2d6a2d' : '#A32D2D', whiteSpace: 'pre-wrap' }}>
      {flash.text}
    </p>
  ) : null;
  return { ok, err, node, clear: () => setFlash(null) };
}

/** 呼叫後台 API（自動帶登入憑證） */
export async function authFetch(url: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${data.session?.access_token ?? ''}`);
  return fetch(url, { ...init, headers });
}

export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '—');

/** 把資料庫錯誤訊息轉成比較好懂的中文（觸發器/函式丟出的訊息本來就是中文，直接顯示即可） */
export function errText(e: unknown): string {
  const m = (e as any)?.message ?? String(e);
  if (/row-level security|permission denied/i.test(m)) return '沒有權限執行這個動作（只有承辦人可以）';
  if (/duplicate key/i.test(m)) return '資料重複了';
  return m;
}

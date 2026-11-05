'use client';

// 三套配色：森林手帳（預設）／晴空活力／薄荷汽水。顏色定義在 app/globals.css 的 data-theme。
// 選擇記在這個瀏覽器（localStorage）；讀不到就用預設。
export type ThemeKey = 'forest' | 'sky' | 'mint';

export const THEMES: { key: ThemeKey; label: string; color: string }[] = [
  { key: 'forest', label: '森林手帳', color: '#2E9166' },
  { key: 'sky', label: '晴空活力', color: '#2F7BFF' },
  { key: 'mint', label: '薄荷汽水', color: '#7C5CFF' },
];

export const THEME_STORAGE_KEY = 'app_theme';

export function getStoredTheme(): ThemeKey {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'sky' || v === 'mint' || v === 'forest') return v;
  } catch {}
  return 'forest';
}

export function applyTheme(t: ThemeKey) {
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, t);
  } catch {}
}

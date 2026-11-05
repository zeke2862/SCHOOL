'use client';

import { useEffect, useState } from 'react';
import { THEMES, ThemeKey, applyTheme, getStoredTheme } from '@/lib/theme';

// 三個小圓點，點一下就換整個系統的配色。
export default function ThemeSwitch() {
  const [theme, setTheme] = useState<ThemeKey>('forest');
  useEffect(() => {
    const t = getStoredTheme();
    setTheme(t);
    applyTheme(t);
  }, []);
  return (
    <span className="no-print keep-size" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} title="配色">
      {THEMES.map((t) => (
        <button
          key={t.key}
          type="button"
          className="keep-size"
          aria-label={`配色：${t.label}`}
          title={t.label}
          onClick={() => {
            setTheme(t.key);
            applyTheme(t.key);
          }}
          style={{
            width: 18,
            height: 18,
            minHeight: 0,
            padding: 0,
            borderRadius: '50%',
            background: t.color,
            cursor: 'pointer',
            border: theme === t.key ? '2px solid var(--ink)' : '2px solid #fff',
            boxShadow: '0 0 0 1px var(--line)',
          }}
        />
      ))}
    </span>
  );
}

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { GAME_MODES, setGameMode, useGameMode } from '@/lib/gameMode';

// 「介面」切換：原始（預設）／RPG／經營。放在上方導覽列、配色圓點旁邊。
export default function GameModeSwitch() {
  const mode = useGameMode();
  const router = useRouter();
  const pathname = usePathname();
  return (
    <span className="no-print keep-size" style={{ display: 'inline-flex', gap: 2, alignItems: 'center', fontSize: 11 }} title="首頁介面風格">
      <span style={{ color: 'var(--sub)', marginRight: 2 }}>介面</span>
      {GAME_MODES.map((m) => (
        <button
          key={m.key}
          type="button"
          className="keep-size"
          title={m.hint}
          aria-pressed={mode === m.key}
          onClick={() => {
            setGameMode(m.key);
            // 面板只在首頁；在別的頁面切到 RPG／經營，就帶你回首頁看到它
            if (m.key !== 'classic' && pathname !== '/admin') router.push('/admin');
          }}
          style={{
            padding: '2px 6px',
            minHeight: 0,
            border: '1px solid ' + (mode === m.key ? 'var(--primary)' : 'var(--line-strong)'),
            background: mode === m.key ? 'var(--primary)' : 'var(--surface)',
            color: mode === m.key ? '#fff' : 'var(--sub)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {m.label}
        </button>
      ))}
    </span>
  );
}

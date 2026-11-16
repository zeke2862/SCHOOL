'use client';

import { useEffect, useState } from 'react';

// 首頁面板風格：原始（預設）／RPG 冒險／閒置經營。
// 選擇記在這個瀏覽器（localStorage），跟配色一樣；讀不到就用原始面板。
export type GameMode = 'classic' | 'rpg' | 'idle';

export const GAME_MODES: { key: GameMode; label: string; hint: string }[] = [
  { key: 'classic', label: '原始', hint: '原本的工作分類表' },
  { key: 'rpg', label: 'RPG', hint: 'RPG 冒險：點名是每日任務，通知是新任務' },
  { key: 'idle', label: '經營', hint: '閒置經營：校園建築自己累積，有空再收成' },
];

export const GAME_MODE_KEY = 'app_game_mode';
const EVENT = 'game-mode-change';

export function getGameMode(): GameMode {
  try {
    const v = localStorage.getItem(GAME_MODE_KEY);
    if (v === 'rpg' || v === 'idle' || v === 'classic') return v;
  } catch {}
  return 'classic';
}

// 整個系統的外觀靠 <html data-game="rpg|idle"> 切換（樣式在 app/globals.css）；原始面板就不加這個屬性。
export function applyGameMode(m: GameMode) {
  try {
    if (m === 'classic') document.documentElement.removeAttribute('data-game');
    else document.documentElement.setAttribute('data-game', m);
  } catch {}
}

export function setGameMode(m: GameMode) {
  try {
    localStorage.setItem(GAME_MODE_KEY, m);
  } catch {}
  applyGameMode(m);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: m }));
}

export function useGameMode(): GameMode {
  const [mode, setMode] = useState<GameMode>('classic');
  useEffect(() => {
    setMode(getGameMode());
    applyGameMode(getGameMode());
    const on = () => {
      setMode(getGameMode());
      applyGameMode(getGameMode());
    };
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return mode;
}

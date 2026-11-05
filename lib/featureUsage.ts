'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// 功能使用次數：首頁「我的常用」、方塊顏色深淺、「全校常用」標記都用這裡。
// 為了不拖慢網頁：點擊時只在這台電腦的 localStorage 加 1，不連線；
// 進首頁／入口時才把累積的次數「批次」送一次（一支很小的 RPC），之後每分鐘最多再送一次。
// 資料庫函式（sql/144）還沒建、或沒登入時，所有動作都會安靜略過，不影響原本功能。
// 功能代號：hub:入口 、 tab:入口/功能 、 extra:其他連結

export type Counts = Record<string, number>;
const PENDING = 'fu_pending';
const CACHE = 'fu_cache_v1';
const TTL = 10 * 60 * 1000;

function readJson<T>(store: Storage | null, k: string, fallback: T): T {
  try {
    const v = store?.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(store: Storage | null, k: string, v: unknown) {
  try {
    store?.setItem(k, JSON.stringify(v));
  } catch {}
}
const ls = () => (typeof window === 'undefined' ? null : window.localStorage);
const ss = () => (typeof window === 'undefined' ? null : window.sessionStorage);

/** 記一次使用（只寫本機，立刻返回） */
export function recordUse(key: string) {
  if (typeof window === 'undefined') return;
  const p = readJson<Counts>(ls(), PENDING, {});
  if (!(key in p) && Object.keys(p).length >= 200) return;
  p[key] = Math.min((p[key] ?? 0) + 1, 1000);
  writeJson(ls(), PENDING, p);
}

let flushing = false;
let disabled = false; // 資料庫函式不存在時，這次開啟網頁期間不再重試

function putBack(p: Counts) {
  const now = readJson<Counts>(ls(), PENDING, {});
  for (const k of Object.keys(p)) now[k] = (now[k] ?? 0) + p[k];
  writeJson(ls(), PENDING, now);
}

/** 把累積的次數批次送到資料庫；失敗就放回去下次再送 */
export async function flushUsage() {
  if (typeof window === 'undefined' || flushing || disabled) return;
  const p = readJson<Counts>(ls(), PENDING, {});
  if (Object.keys(p).length === 0) return;
  flushing = true;
  writeJson(ls(), PENDING, {});
  try {
    const { error } = await supabase.rpc('bump_feature_usage', { p_counts: p });
    if (error) {
      putBack(p);
      if (/does not exist|PGRST202|42883/.test(`${error.code ?? ''} ${error.message ?? ''}`)) disabled = true;
    } else {
      try { ss()?.removeItem(CACHE); } catch {}
    }
  } catch {
    putBack(p);
  } finally {
    flushing = false;
  }
}

type Loaded = { mine: Counts; school: Counts };
const EMPTY: Loaded = { mine: {}, school: {} };

export async function loadUsage(): Promise<Loaded> {
  if (typeof window === 'undefined' || disabled) return EMPTY;
  const c = readJson<{ at: number; d: Loaded } | null>(ss(), CACHE, null);
  if (c && Date.now() - c.at < TTL) return c.d;
  try {
    const [a, b] = await Promise.all([supabase.rpc('my_feature_usage'), supabase.rpc('school_feature_usage')]);
    if (a.error || b.error) return EMPTY;
    const mine: Counts = {};
    for (const r of (a.data ?? []) as { key: string; n: number }[]) mine[r.key] = r.n;
    const school: Counts = {};
    for (const r of (b.data ?? []) as { key: string; users: number }[]) school[r.key] = r.users;
    const d = { mine, school };
    writeJson(ss(), CACHE, { at: Date.now(), d });
    return d;
  } catch {
    return EMPTY;
  }
}

/** 讀取使用次數（自己的已含「還沒送出去」的新點擊）。進入頁面時順便送出累積的次數。 */
export function useFeatureUsage(): Loaded {
  const [d, setD] = useState<Loaded>(EMPTY);
  useEffect(() => {
    let alive = true;
    flushUsage()
      .then(() => loadUsage())
      .then((r) => { if (alive) setD(r); });
    const iv = setInterval(() => void flushUsage(), 60000);
    const onHide = () => { if (document.visibilityState === 'hidden') void flushUsage(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);
  return useMemo(() => {
    const mine = { ...d.mine };
    const p = readJson<Counts>(ls(), PENDING, {});
    for (const k of Object.keys(p)) mine[k] = (mine[k] ?? 0) + p[k];
    return { mine, school: d.school };
  }, [d]);
}

/** 一個入口的個人使用量 ＝ 點入口方塊的次數 ＋ 入口裡各功能的次數 */
export function hubUse(mine: Counts, hubKey: string): number {
  let n = mine[`hub:${hubKey}`] ?? 0;
  const pre = `tab:${hubKey}/`;
  for (const k of Object.keys(mine)) if (k.startsWith(pre)) n += mine[k];
  return n;
}

/** 用量 → 0～4 級（相對於這一批裡用最多的那個） */
export function levelOf(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  const r = n / max;
  return r >= 0.75 ? 4 : r >= 0.5 ? 3 : r >= 0.25 ? 2 : 1;
}

const SHADE = [0, 5, 10, 16, 24];
/** 越常用，方塊底色越偏主色（淺淺的，文字仍然清楚） */
export function shadeBg(level: number): string {
  const p = SHADE[Math.max(0, Math.min(4, level))];
  return p === 0 ? 'var(--surface)' : `color-mix(in srgb, var(--primary) ${p}%, var(--surface))`;
}

/** 全校常用：用過的人數最多的前幾名，且至少要有 minUsers 位老師用過（資料太少不標，避免誤導） */
export function topSchool(school: Counts, keys: string[], top = 3, minUsers = 3): Set<string> {
  return new Set(
    keys
      .filter((k) => (school[k] ?? 0) >= minUsers)
      .sort((a, b) => (school[b] ?? 0) - (school[a] ?? 0))
      .slice(0, top),
  );
}

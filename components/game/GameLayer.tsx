'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCaps } from '@/lib/useCaps';
import { useGameMode, type GameMode } from '@/lib/gameMode';
import {
  PLANTS, PROFILE_EVENT, Profile, SPECIES, levelOf, levelRange, loadProfile, peekProfile, peekQuestSummary, plantProgress, stageOf, syncGame, titleOf,
} from '@/lib/gameData';
import { PetArt, PlantArt } from '@/components/game/GameArt';

// 全站的遊戲層（只有選了 RPG／經營的人才會載入）：
//   1. 上方狀態列：等級、經驗、星星、連勝、今日任務（RPG）／星星、可收成的花（經營）
//   2. 每一頁角落的小夥伴：RPG 是你的寵物、經營是花園裡的植物，點一下會說話
//   3. 在別的頁面完成任務（點名、打卡、處理通知）後，換頁時自動結算並跳出「任務完成」
// 狀態列與小夥伴只讀這台裝置暫存的進度，不查資料庫；結算最多每 90 秒查一次。

const SYNC_GAP_MS = 90_000;
const syncKey = (id: string) => `game_sync_at_${id}`;

const LINES: [string, string][] = [
  ['/attendance', '點名加油！今天的出缺席交給你了'],
  ['/rollbook', '名冊整理好，心情也跟著整齊'],
  ['/clock', '打卡完成，今天也是準時的一天'],
  ['/leave', '請假的事交給系統，你好好休息'],
  ['/review', '審核任務來了，慢慢處理不用急'],
  ['/notifications', '有新消息就是有新任務'],
  ['/account', '帳號設定好，冒險才安心'],
];
const RPG_GENERIC = ['今天也一起加油', '完成任務就會有飼料喔', '喝口水再繼續吧', '你做得很好', '我會一直陪著你'];
const IDLE_GENERIC = ['花兒在偷偷長大喔', '星星會自己累積，不用急', '有空回首頁收成吧', '今天也是溫柔的一天', '深呼吸，慢慢來'];

function lineFor(path: string, mode: GameMode): string {
  const hit = LINES.find(([p]) => path.startsWith(p));
  const pool = mode === 'rpg' ? RPG_GENERIC : IDLE_GENERIC;
  if (hit && Math.random() < 0.6) return hit[1];
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function GameLayer() {
  const mode = useGameMode();
  const { caps } = useCaps();
  const tid = caps?.ident.teacherId ?? null;
  if (mode === 'classic' || !tid || caps?.ident.acting) return null;
  return <GameLayerInner teacherId={tid} mode={mode} />;
}

function GameLayerInner({ teacherId, mode }: { teacherId: string; mode: Exclude<GameMode, 'classic'> }) {
  const pathname = usePathname() ?? '';
  const [profile, setProfile] = useState<Profile | null>(() => (typeof window === 'undefined' ? null : peekProfile(teacherId)));
  const [summary, setSummary] = useState<{ done: number; total: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState('');
  const [line, setLine] = useState('');
  const onHome = pathname === '/admin';

  const reload = useCallback(() => {
    setProfile(peekProfile(teacherId));
    setSummary(peekQuestSummary(teacherId));
  }, [teacherId]);

  useEffect(() => {
    reload();
    // 這台裝置還沒有暫存進度（第一次、或剛換裝置）：只查一次進度
    if (!peekProfile(teacherId)) loadProfile(teacherId).then((r) => setProfile(r.profile)).catch(() => {});
    window.addEventListener(PROFILE_EVENT, reload);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener(PROFILE_EVENT, reload);
      clearInterval(t);
    };
  }, [teacherId, reload]);

  // 換頁時結算（首頁的面板自己會結算，不重複）；最多每 90 秒一次
  useEffect(() => {
    setLine('');
    if (onHome) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(syncKey(teacherId)) ?? 0);
    } catch {
      /* 略過 */
    }
    if (Date.now() - last < SYNC_GAP_MS) return;
    try {
      sessionStorage.setItem(syncKey(teacherId), String(Date.now()));
    } catch {
      /* 略過 */
    }
    let alive = true;
    syncGame(teacherId)
      .then((r) => {
        if (!alive) return;
        reload();
        if (r.gained > 0) setToast(`任務完成！+${r.gained} XP／+${r.gained} 星星${r.levelUp ? '，升級了！' : ''}`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, teacherId, onHome, reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!profile) return null;
  const lv = levelOf(profile.xp);
  const range = levelRange(lv);
  const xpPct = Math.round(((profile.xp - range.from) / (range.to - range.from)) * 100);
  const ex = profile.extras;
  const ready = ex.plots.filter((pl) => {
    if (!pl) return false;
    const d = PLANTS.find((x) => x.key === pl.plant);
    return !!d && plantProgress(pl, d, now) >= 1;
  }).length;

  const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' };

  const hud = !onHome && (
    <div className="game-hud no-print" role="status" aria-label="遊戲狀態">
      {mode === 'rpg' ? (
        <>
          <span style={chip}>⚔️ <b>Lv {lv}</b> {titleOf(lv)}</span>
          <span style={{ ...chip, minWidth: 90 }} title={`${profile.xp - range.from} / ${range.to - range.from} XP`}>
            <span className="game-bar"><i style={{ width: `${xpPct}%` }} /></span>
          </span>
          <span style={chip}>⭐ {profile.stars}</span>
          <span style={chip}>🔥 連勝 {profile.streak} 天</span>
          {summary && <span style={chip}>📜 今日任務 {summary.done}/{summary.total}</span>}
          <span style={chip}>🍖 飼料 {ex.food}</span>
        </>
      ) : (
        <>
          <span style={chip}>🏫 <b>校譽 Lv {lv}</b></span>
          <span style={chip}>⭐ {profile.stars}</span>
          <span style={chip}>🌱 {ready > 0 ? <Link href="/admin" style={{ color: 'inherit', fontWeight: 700 }}>{ready} 株可以收成了</Link> : '花園成長中'}</span>
          <span style={chip}>🔥 連續 {profile.streak} 天</span>
          {summary && <span style={chip}>🧺 今日完成 {summary.done}/{summary.total}</span>}
        </>
      )}
    </div>
  );

  // 小夥伴：RPG＝目前的寵物（沒有就是蛋）；經營＝花園裡第一株植物（沒有就是新芽）
  let buddy: React.ReactNode;
  if (mode === 'rpg') {
    const sp = SPECIES.find((s) => s.key === ex.active);
    buddy = sp ? <PetArt species={sp.key} stage={stageOf(ex.pets[sp.key] ?? 0)} size={64} /> : <PetArt species="chick" stage={0} size={64} />;
  } else {
    const idx = ex.plots.findIndex((p) => !!p);
    const pl = idx >= 0 ? ex.plots[idx] : null;
    const d = pl ? PLANTS.find((x) => x.key === pl.plant) : null;
    buddy = pl && d ? <PlantArt plant={d.key} progress={plantProgress(pl, d, now)} size={68} /> : <PlantArt plant="sunflower" progress={0.1} size={68} />;
  }

  return (
    <>
      {hud}
      {toast && (
        <div className="game-toast no-print" role="status" onClick={() => setToast('')}>
          🎉 {toast}
        </div>
      )}
      {!onHome && (
        <div className="game-buddy no-print">
          {line && <div className="game-bubble">{line}</div>}
          <button type="button" className="keep-size game-buddy-btn" aria-label="小夥伴，點一下說話" onClick={() => setLine(lineFor(pathname, mode))}>
            {buddy}
          </button>
        </div>
      )}
    </>
  );
}

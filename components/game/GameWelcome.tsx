'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCaps } from '@/lib/useCaps';
import { hasChosenGameMode, setGameMode, type GameMode } from '@/lib/gameMode';
import { PetArt, PlantArt } from '@/components/game/GameArt';

// 遊戲版的歡迎畫面：還沒選過介面的老師，登入後先選一種風格（RPG 冒險／校園經營），
// 也可以選「維持原始介面」。選擇記在這台裝置，之後隨時能從右上角「介面」改。
// 只出現一次；代理別人、家長／學生、沒有教師身分的帳號不會看到（遊戲進度屬於教師本人）。

const CHOICES: { key: Exclude<GameMode, 'classic'>; title: string; tag: string; points: string[] }[] = [
  {
    key: 'rpg',
    title: 'RPG 冒險',
    tag: '把每天的工作變成任務',
    points: ['點名、打卡、處理通知＝每日任務', '完成任務拿經驗值升級、開寶箱', '養一隻寵物夥伴，陪你上班'],
  },
  {
    key: 'idle',
    title: '校園經營',
    tag: '輕鬆慢慢來，校園自己長大',
    points: ['建築會自己累積星星，有空再收', '完成工作拿到水和肥料', '種花、收成、蒐集花園圖鑑'],
  },
];

export default function GameWelcome() {
  const { caps } = useCaps();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(!hasChosenGameMode());
  }, []);

  if (!open || !caps?.ident.teacherId || caps.ident.acting) return null;

  const choose = (m: GameMode) => {
    setGameMode(m);
    setOpen(false);
    if (m !== 'classic' && pathname !== '/admin') router.push('/admin');
  };

  return (
    <div className="game-welcome no-print" role="dialog" aria-modal="true" aria-label="選擇介面風格">
      <div className="game-welcome-box">
        <div className="game-welcome-title">今天想用哪一種心情上班？</div>
        <p className="game-welcome-sub">功能和資料完全一樣，只是換個好玩的樣子。之後隨時能從右上角「介面」更換。</p>
        <div className="game-welcome-grid">
          {CHOICES.map((c) => (
            <button key={c.key} type="button" className={'keep-size game-welcome-card game-welcome-' + c.key} onClick={() => choose(c.key)}>
              <span className="game-welcome-art" aria-hidden="true">
                {c.key === 'rpg' ? <PetArt species="fox" stage={2} size={84} /> : <PlantArt plant="sunflower" progress={1} size={84} />}
              </span>
              <span className="game-welcome-name">{c.title}</span>
              <span className="game-welcome-tag">{c.tag}</span>
              <span className="game-welcome-points">
                {c.points.map((p) => (
                  <span key={p}>・{p}</span>
                ))}
              </span>
              <span className="game-welcome-go">選這個</span>
            </button>
          ))}
        </div>
        <button type="button" className="keep-size game-welcome-skip" onClick={() => choose('classic')}>
          先不用，維持原始介面
        </button>
      </div>
    </div>
  );
}

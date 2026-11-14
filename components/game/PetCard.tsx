'use client';

import { useState } from 'react';
import { FEED_AMOUNT, Profile, SPECIES, STAGES, levelOf, stageOf } from '@/lib/gameData';
import { PetArt } from '@/components/game/GameArt';

// RPG 面板上的小寵物：任務換來的飼料拿去餵，吃夠了就進化。
// 不會餓死、不會生氣；太久沒來只是在打瞌睡，回來摸一下就醒了。
const KEYFRAMES = '@keyframes gm-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes gm-pop{0%{transform:scale(.6)}60%{transform:scale(1.25)}100%{transform:scale(1)}}';
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--primary)', background: 'var(--primary)', color: '#fff', fontSize: 13, cursor: 'pointer', minHeight: 0 };
const btnGhost: React.CSSProperties = { ...btn, background: 'var(--surface)', color: 'var(--primary-ink)' };

export default function PetCard({ profile, commit, notify, sleepy }: { profile: Profile; commit: (p: Profile) => void; notify: (m: string) => void; sleepy: boolean }) {
  const ex = profile.extras;
  const lv = levelOf(profile.xp);
  const [line, setLine] = useState('');
  const [evolve, setEvolve] = useState(0);
  const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 14px', marginBottom: 12 };

  const choose = (key: string) => {
    const sp = SPECIES.find((s) => s.key === key);
    // 第一隻可以自由挑任何一種；之後要換、要收集，其他夥伴依等級解鎖
    if (!sp || (ex.active && lv < sp.unlock && !(key in ex.pets))) return;
    commit({ ...profile, extras: { ...ex, active: key, pets: { ...ex.pets, [key]: ex.pets[key] ?? 0 } } });
    setLine('');
    notify(ex.active ? `換成${sp.name}出場` : `${sp.name}的蛋孵化中，多完成任務來餵牠吧`);
  };

  // ---- 還沒有寵物：選一顆蛋 ----
  if (!ex.active) {
    return (
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>🥚 選一顆蛋，領養你的第一位夥伴</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SPECIES.map((s) => (
            <button key={s.key} onClick={() => choose(s.key)} style={{ ...btnGhost, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 10px' }}>
              <PetArt species={s.key} stage={2} size={48} />
              {s.name}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--sub)', margin: '6px 0 0' }}>第一隻可以自由挑選；其他夥伴會隨等級解鎖（之後都能換出場）。</p>
      </div>
    );
  }

  const sp = SPECIES.find((s) => s.key === ex.active) ?? SPECIES[0];
  const fed = ex.pets[sp.key] ?? 0;
  const stage = stageOf(fed);
  const st = STAGES[stage];
  const next = STAGES[stage + 1];
  const pct = next ? ((fed - st.min) / (next.min - st.min)) * 100 : 100;

  return (
    <div style={card}>
      <style>{KEYFRAMES}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          aria-label={`${sp.name}，點一下互動`}
          onClick={() => setLine(sleepy ? '嗯…你回來啦（揉眼睛）' : sp.hello[Math.floor(Math.random() * sp.hello.length)])}
          style={{ position: 'relative', width: 84, height: 84, border: 'none', background: 'var(--primary-soft)', borderRadius: '50%', cursor: 'pointer', lineHeight: 0, minHeight: 0, padding: 0, animation: sleepy ? 'none' : 'gm-bounce 2.2s ease-in-out infinite' }}
        >
          <span key={evolve} style={{ display: 'inline-block', animation: evolve ? 'gm-pop .6s' : 'none' }}>
            <PetArt species={sp.key} stage={stage} sleepy={sleepy} size={80} />
          </span>
          {sleepy && <span style={{ position: 'absolute', top: 0, right: 0, fontSize: 16, lineHeight: 1 }}>💤</span>}
        </button>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{sp.name} · {st.label}</div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--primary-soft)', overflow: 'hidden', margin: '5px 0 3px' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#E0A100', transition: 'width .5s' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--sub)' }}>{next ? `再餵 ${next.min - fed} 進化成「${next.label}」` : '已經是完全體，閃閃發亮'}</div>
          {line && <div style={{ fontSize: 13, marginTop: 4, color: 'var(--primary-ink)' }}>💬 {line}</div>}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 4 }}>🍖 飼料 {ex.food}</div>
          <button
            style={ex.food >= FEED_AMOUNT ? btn : { ...btnGhost, opacity: 0.6 }}
            onClick={() => {
              if (ex.food < FEED_AMOUNT) return notify('飼料不夠，完成任務就會有飼料');
              const nf = fed + FEED_AMOUNT;
              commit({ ...profile, extras: { ...ex, food: ex.food - FEED_AMOUNT, pets: { ...ex.pets, [sp.key]: nf } } });
              if (stageOf(nf) > stage) {
                setEvolve((n) => n + 1);
                notify(`${sp.name}進化了！現在是「${STAGES[stageOf(nf)].label}」`);
                setLine('');
              } else setLine('好好吃！');
            }}
          >
            餵食 −{FEED_AMOUNT}
          </button>
        </div>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 12, color: 'var(--sub)', cursor: 'pointer' }}>我的夥伴（{Object.keys(ex.pets).length} / {SPECIES.length}）· 換一隻出場</summary>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {SPECIES.map((s) => {
            const mine = s.key in ex.pets;
            const open = mine || lv >= s.unlock;
            return (
              <button key={s.key} onClick={() => choose(s.key)} style={{ ...btnGhost, opacity: open ? 1 : 0.45, cursor: open ? 'pointer' : 'not-allowed', border: s.key === ex.active ? '2px solid var(--primary)' : '1px solid var(--line-strong)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ lineHeight: 0, filter: open ? 'none' : 'grayscale(1)' }}><PetArt species={s.key} stage={mine ? Math.max(1, stageOf(ex.pets[s.key] ?? 0)) : 1} size={32} /></span>
                <span style={{ fontSize: 12 }}>{open ? (mine ? STAGES[stageOf(ex.pets[s.key] ?? 0)].label : '新夥伴') : `Lv ${s.unlock}`}</span>
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}

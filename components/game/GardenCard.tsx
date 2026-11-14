'use client';

import { useState } from 'react';
import { FERT_COST, FERT_HOURS, MAX_PLOTS, PLANTS, Profile, WATER_COST, WATER_HOURS, plantProgress, plantStage, plotCost } from '@/lib/gameData';

// 經營面板的花園：種子 → 發芽 → 長葉 → 花苞 → 開花 → 結果。
// 等待是免費的（用真實時間計算，沒開網頁也在長），澆水、施肥只是用星星換時間；植物不會枯萎。
const KEYFRAMES = '@keyframes gm-sway{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}@keyframes gm-glow{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}';
const btn: React.CSSProperties = { padding: '5px 10px', borderRadius: 8, border: '1px solid var(--primary)', background: 'var(--primary)', color: '#fff', fontSize: 12, cursor: 'pointer', minHeight: 0 };
const btnGhost: React.CSSProperties = { ...btn, background: 'var(--surface)', color: 'var(--primary-ink)' };
const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px' };

function left(hours: number) {
  if (hours <= 0) return '';
  const h = Math.floor(hours);
  const m = Math.ceil((hours - h) * 60);
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分鐘`;
}

export default function GardenCard({ profile, commit, notify, now }: { profile: Profile; commit: (p: Profile) => void; notify: (m: string) => void; now: number }) {
  const ex = profile.extras;
  const [picking, setPicking] = useState<number | null>(null);
  const setPlot = (i: number, v: (typeof ex.plots)[number], stars: number, dex = ex.dex) => {
    const plots = ex.plots.slice();
    plots[i] = v;
    commit({ ...profile, stars, extras: { ...ex, plots, dex } });
  };

  return (
    <div style={{ marginTop: 14 }}>
      <style>{KEYFRAMES}</style>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🌱 我的花園 <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--sub)' }}>放著不管也會自己長大</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {ex.plots.map((pl, i) => {
          if (!pl) {
            return (
              <div key={i} style={{ ...card, textAlign: 'center' }}>
                <div style={{ fontSize: 26, opacity: 0.5 }}>🟫</div>
                {picking === i ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                    {PLANTS.map((d) => (
                      <button
                        key={d.key}
                        style={{ ...btnGhost, display: 'flex', justifyContent: 'space-between', opacity: profile.stars >= d.seed ? 1 : 0.5 }}
                        onClick={() => {
                          if (profile.stars < d.seed) return notify(`種子 ${d.seed} 星星，還差 ${d.seed - profile.stars}`);
                          setPlot(i, { plant: d.key, t: Date.now(), bonus: 0 }, profile.stars - d.seed);
                          setPicking(null);
                          notify(`種下了${d.name}，${d.hours} 小時後成熟`);
                        }}
                      >
                        <span>{d.flower} {d.name}</span>
                        <span>{d.seed}⭐</span>
                      </button>
                    ))}
                    <button style={{ ...btnGhost, border: 'none' }} onClick={() => setPicking(null)}>取消</button>
                  </div>
                ) : (
                  <button style={{ ...btn, marginTop: 6 }} onClick={() => setPicking(i)}>種植</button>
                )}
              </div>
            );
          }
          const d = PLANTS.find((x) => x.key === pl.plant) ?? PLANTS[0];
          const p = plantProgress(pl, d, now);
          const s = plantStage(d, p);
          const remain = d.hours - ((now - pl.t) / 3600000 + pl.bonus);
          return (
            <div key={i} style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontSize: s.size, lineHeight: 1.2, height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ display: 'inline-block', transformOrigin: '50% 100%', animation: p >= 1 ? 'gm-glow 1.6s ease-in-out infinite' : 'gm-sway 3s ease-in-out infinite' }}>{s.e}</span>
                {p >= 1 && <span style={{ fontSize: 16 }}>✨</span>}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{d.name} · {s.label}</div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--primary-soft)', overflow: 'hidden', margin: '5px 0 3px' }}>
                <div style={{ width: `${Math.round(p * 100)}%`, height: '100%', background: '#4CAF73', transition: 'width .5s' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--sub)', marginBottom: 6 }}>{p >= 1 ? `收成可得 ${d.reward} ⭐` : `還要 ${left(remain)}`}</div>
              {p >= 1 ? (
                <button
                  style={btn}
                  onClick={() => {
                    const first = !ex.dex.includes(d.key);
                    setPlot(i, null, profile.stars + d.reward, first ? [...ex.dex, d.key] : ex.dex);
                    notify(first ? `收成 +${d.reward} 星星，${d.name}加入圖鑑！` : `收成 +${d.reward} 星星`);
                  }}
                >
                  收成
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  <button
                    style={btnGhost}
                    onClick={() => {
                      if (profile.stars < WATER_COST) return notify(`澆水要 ${WATER_COST} 星星`);
                      setPlot(i, { ...pl, bonus: pl.bonus + WATER_HOURS }, profile.stars - WATER_COST);
                    }}
                  >
                    💧 {WATER_COST}
                  </button>
                  <button
                    style={btnGhost}
                    onClick={() => {
                      if (profile.stars < FERT_COST) return notify(`肥料要 ${FERT_COST} 星星`);
                      setPlot(i, { ...pl, bonus: pl.bonus + FERT_HOURS }, profile.stars - FERT_COST);
                    }}
                  >
                    🧪 {FERT_COST}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {ex.plots.length < MAX_PLOTS && (
          <div style={{ ...card, textAlign: 'center', borderStyle: 'dashed' }}>
            <div style={{ fontSize: 26, opacity: 0.5 }}>➕</div>
            <button
              style={{ ...btnGhost, marginTop: 6 }}
              onClick={() => {
                const c = plotCost(ex.plots.length);
                if (profile.stars < c) return notify(`新花圃要 ${c} 星星，還差 ${c - profile.stars}`);
                commit({ ...profile, stars: profile.stars - c, extras: { ...ex, plots: [...ex.plots, null] } });
                notify('多了一塊花圃');
              }}
            >
              開墾 {plotCost(ex.plots.length)}⭐
            </button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 8 }}>
        圖鑑 {ex.dex.length} / {PLANTS.length}：{PLANTS.map((d) => (ex.dex.includes(d.key) ? d.fruit : '❔')).join(' ')}
        <span style={{ marginLeft: 8 }}>💧 +{WATER_HOURS} 小時　🧪 +{FERT_HOURS} 小時</span>
      </div>
    </div>
  );
}

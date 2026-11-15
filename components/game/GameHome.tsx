'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { GameMode } from '@/lib/gameMode';
import PetCard from '@/components/game/PetCard';
import GardenCard from '@/components/game/GardenCard';
import {
  BUILDINGS, IDLE_CAP_HOURS, Profile, Quest, EMPTY_PROFILE,
  claim, levelOf, levelRange, loadProfile, loadQuests, pending, perHour, saveProfile, saveQuestSummary, titleOf, upgradeCost,
} from '@/lib/gameData';

// 首頁的遊戲化面板（RPG／經營）。預設的「原始」面板不會載入這個元件。
// 資料只在載入、切回分頁時查一次，沒有輪詢；畫面上的數字更新全是本機計算。

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' };
const bar = (pct: number, color: string, bg = 'var(--primary-soft)') => (
  <div style={{ height: 10, borderRadius: 5, background: bg, overflow: 'hidden' }}>
    <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: color, transition: 'width .5s' }} />
  </div>
);
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--primary)', background: 'var(--primary)', color: '#fff', fontSize: 13, cursor: 'pointer', minHeight: 0 };
const btnGhost: React.CSSProperties = { ...btn, background: 'var(--surface)', color: 'var(--primary-ink)' };
const CHEST_MSGS = ['今天辛苦了，記得喝口水', '你的點名完整度 100%', '下課記得起來走一走', '掉落：15 分鐘下午茶時間', '謝謝你，學生們都有被好好照顧到'];

export default function GameHome({ teacherId, mode }: { teacherId: string; mode: Exclude<GameMode, 'classic'> }) {
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [remote, setRemote] = useState(true);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const profRef = useRef<Profile>(EMPTY_PROFILE);
  const remoteRef = useRef(true);

  const commit = useCallback(
    (p: Profile) => {
      profRef.current = p;
      setProfile(p);
      saveProfile(teacherId, p, remoteRef.current);
    },
    [teacherId],
  );

  const refresh = useCallback(async () => {
    try {
      const [{ profile: loaded, remote: r }, qs] = await Promise.all([loadProfile(teacherId), loadQuests(teacherId)]);
      remoteRef.current = r;
      setRemote(r);
      const res = claim(loaded, qs);
      // 經營面板：第一次看到建築就從現在開始累積
      const b = { ...res.profile.buildings };
      let touched = false;
      for (const d of ['classroom', 'office', 'gate']) {
        if (!b[d]) {
          b[d] = { lv: 1, t: Date.now() };
          touched = true;
        }
      }
      const next = touched ? { ...res.profile, buildings: b } : res.profile;
      if (res.gained > 0 || touched || next !== loaded) commit(next);
      else {
        profRef.current = next;
        setProfile(next);
      }
      if (res.gained > 0) setToast(`任務完成！+${res.gained} XP／+${res.gained} 星星${res.levelUp ? '，升級了！' : ''}`);
      saveQuestSummary(teacherId, qs);
      setQuests(qs);
    } catch {
      setQuests((q) => q ?? []);
    }
  }, [teacherId, commit]);

  useEffect(() => {
    refresh();
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, [refresh]);

  if (!quests) return <div style={{ ...card, marginBottom: 20, color: 'var(--sub)', fontSize: 13 }}>載入任務中…</div>;

  const lv = levelOf(profile.xp);
  const range = levelRange(lv);
  const done = quests.filter((q) => q.done).length;
  const todo = quests.filter((q) => !q.done);

  const footer = (
    <p style={{ fontSize: 11, color: 'var(--sub)', margin: '10px 0 0' }}>
      目前是「{mode === 'rpg' ? 'RPG' : '經營'}」面板，右上角「介面」可以隨時切回原始。
      {!remote && '（進度暫存在這台裝置；管理員執行 sql/151 後會跟著帳號走。）'}
    </p>
  );

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
      <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{mode === 'rpg' ? '⚔️' : '🏫'}</div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700 }}>
          <span>Lv {lv} {titleOf(lv)}</span>
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--sub)' }}>{profile.xp - range.from} / {range.to - range.from} XP</span>
        </div>
        <div style={{ marginTop: 5 }}>{bar(((profile.xp - range.from) / (range.to - range.from)) * 100, 'var(--primary)')}</div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)' }}><div style={{ fontSize: 18 }}>🔥</div>連勝 {profile.streak} 天</div>
      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)' }}><div style={{ fontSize: 18 }}>⭐</div>{profile.stars}</div>
    </div>
  );

  const toastEl = toast && (
    <div role="status" onClick={() => setToast('')} style={{ background: '#FFF4D6', border: '1px solid #E4D5A8', color: '#8A5A00', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10, cursor: 'pointer' }}>
      🎉 {toast}
    </div>
  );

  // ================= RPG =================
  if (mode === 'rpg') {
    const newNotices = todo.filter((q) => q.kind === 'notice');
    const allDone = quests.length > 0 && done === quests.length;
    const chestOpened = profile.claimed.includes('chest');
    return (
      <section style={{ ...card, marginBottom: 20, background: 'var(--primary-soft)' }}>
        {header}
        {toastEl}
        <PetCard profile={profile} commit={commit} notify={setToast} sleepy={!!profile.last_day && (Date.now() - new Date(profile.last_day + 'T00:00:00+08:00').getTime()) / 86400000 > 4} />
        {newNotices.length > 0 && (
          <div style={{ background: '#FFF4D6', border: '1px solid #E4D5A8', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#8A5A00' }}>🔔 新任務出現！（{newNotices.length}）</div>
            {newNotices.slice(0, 3).map((q) => (
              <div key={q.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 13, color: '#8A5A00' }}>
                <span style={{ flex: 1 }}>{q.title} · +{q.xp} XP</span>
                <Link href={q.href} style={{ ...btn, textDecoration: 'none' }}>接受任務</Link>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 6 }}>今日任務 {done} / {quests.length}</div>
        {quests.length === 0 && <div style={{ ...card, fontSize: 13, color: 'var(--sub)' }}>今天沒有任務，好好休息 ☕</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {quests.map((q) => (
            <div key={q.key} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', opacity: q.done ? 0.55 : 1 }}>
              <span style={{ fontSize: 18 }}>{q.done ? '✅' : q.kind === 'notice' ? '📜' : q.kind === 'clock' ? '⏰' : '⬜'}</span>
              <div style={{ flex: 1, fontSize: 14 }}>
                {q.title}
                {q.sub && <div style={{ fontSize: 12, color: 'var(--sub)' }}>{q.sub}</div>}
              </div>
              <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: '#FFF4D6', color: '#8A5A00' }}>+{q.xp}</span>
              {!q.done && <Link href={q.href} style={{ ...btnGhost, textDecoration: 'none' }}>前往</Link>}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            style={allDone && !chestOpened ? btn : { ...btnGhost, opacity: 0.7 }}
            onClick={() => {
              if (!allDone) return setToast(`還有 ${quests.length - done} 個任務沒完成，完成後就能開寶箱`);
              if (chestOpened) return setToast('今天的寶箱已經開過了');
              const p = { ...profRef.current, stars: profRef.current.stars + 10, claimed: [...profRef.current.claimed, 'chest'] };
              commit(p);
              setToast(`寶箱：${CHEST_MSGS[Math.floor(Math.random() * CHEST_MSGS.length)]}（+10 星星）`);
            }}
          >
            🎁 開寶箱
          </button>
          <span style={{ fontSize: 12, color: 'var(--sub)' }}>完成當天所有任務就能開啟</span>
        </div>
        {footer}
      </section>
    );
  }

  // ================= 閒置經營 =================
  const statusOf = (key: string): { text: string; href: string } => {
    if (key === 'classroom') {
      const rc = quests.filter((q) => q.kind === 'rollcall');
      const left = rc.filter((q) => !q.done).length;
      return { text: rc.length === 0 ? '今天沒有課' : left === 0 ? `今日 ${rc.length} 節點名完成` : `還有 ${left} 節待點名`, href: '/attendance/mobile' };
    }
    const nt = quests.filter((q) => q.kind === 'notice');
    const left = nt.filter((q) => !q.done).length;
    if (key === 'gate') {
      const ck = quests.filter((q) => q.kind === 'clock');
      const left = ck.filter((q) => !q.done).length;
      const visitors = quests.filter((q) => q.kind === 'notice' && !q.done).length;
      if (ck.length > 0 && left > 0) return { text: `${left} 次打卡未完成`, href: '/clock' };
      return { text: visitors === 0 ? '大廳很安靜' : `${visitors} 位訪客等你接待`, href: visitors === 0 ? '/clock' : '/notifications' };
    }
    if (key === 'office') return { text: left === 0 ? '沒有待處理的通知' : `${left} 件待處理`, href: '/notifications' };
    return { text: left === 0 ? '大廳很安靜' : `${left} 位訪客等你接待`, href: '/notifications' };
  };

  return (
    <section style={{ ...card, marginBottom: 20, background: 'var(--primary-soft)' }}>
      {header}
      {toastEl}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        {BUILDINGS.map((d) => {
          const b = profile.buildings[d.key] ?? { lv: 1, t: now };
          const got = pending(b, now);
          const st = statusOf(d.key);
          const cap = perHour(b.lv) * IDLE_CAP_HOURS;
          return (
            <div key={d.key} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 26 }}>{d.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{d.name} <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 9, background: 'var(--primary-soft)', color: 'var(--primary-ink)' }}>Lv {b.lv}</span></div>
                  <Link href={st.href} style={{ fontSize: 12, color: 'var(--primary-ink)' }}>{st.text} ›</Link>
                </div>
              </div>
              {bar((got / cap) * 100, 'var(--primary)')}
              <div style={{ fontSize: 11, color: 'var(--sub)', margin: '4px 0 8px' }}>每小時 +{perHour(b.lv)} ⭐，最多累積 {IDLE_CAP_HOURS} 小時</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={{ ...(got > 0 ? btn : { ...btnGhost, opacity: 0.7 }), flex: 1 }}
                  onClick={() => {
                    if (got <= 0) return setToast('還沒累積到星星，過一會兒再來');
                    const p = profRef.current;
                    commit({ ...p, stars: p.stars + got, buildings: { ...p.buildings, [d.key]: { ...b, t: Date.now() } } });
                    setToast(`收成 +${got} 星星`);
                  }}
                >
                  收成 +{got} ⭐
                </button>
                <button
                  style={btnGhost}
                  onClick={() => {
                    const p = profRef.current;
                    const cost = upgradeCost(b.lv);
                    if (p.stars < cost) return setToast(`升級需要 ${cost} 星星，還差 ${cost - p.stars}`);
                    // 升級前先把累積的結清，避免白白損失
                    commit({ ...p, stars: p.stars - cost + got, buildings: { ...p.buildings, [d.key]: { lv: b.lv + 1, t: Date.now() } } });
                    setToast(`${d.name}升到 Lv ${b.lv + 1}`);
                  }}
                >
                  升級 {upgradeCost(b.lv)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <GardenCard profile={profile} commit={commit} notify={setToast} now={now} />
      <p style={{ fontSize: 12, color: 'var(--sub)', margin: '10px 0 0' }}>建築會自己累積星星，不用盯著畫面。完成點名、處理通知也會直接獲得星星與經驗值。</p>
      {footer}
    </section>
  );
}

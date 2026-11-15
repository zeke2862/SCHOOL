'use client';

import { supabase } from '@/lib/supabaseClient';
import { resolveCurrentTerm } from '@/lib/academicTerm';

// 遊戲化面板的資料層。任務一律由既有資料表即時推導（課表、點名紀錄、通知），
// 只有「玩家進度」（經驗值、星星、連勝、建築）另存。只在載入面板、切回分頁時查詢，不輪詢。

export type Quest = {
  key: string;
  kind: 'rollcall' | 'notice' | 'clock';
  title: string;
  sub?: string;
  xp: number;
  done: boolean;
  href: string;
};

export type Building = { lv: number; t: number };
export type Plot = { plant: string; t: number; bonus: number };
// 寵物與花園：飼料（任務換來、拿去餵寵物）、已領養的寵物（種類 → 已餵食量）、花圃、圖鑑
export type Extras = { food: number; active: string | null; pets: Record<string, number>; plots: (Plot | null)[]; dex: string[] };
export const EMPTY_EXTRAS: Extras = { food: 0, active: null, pets: {}, plots: [null, null], dex: [] };
export type Profile = {
  xp: number;
  stars: number;
  streak: number;
  last_day: string | null;
  claimed_day: string | null;
  claimed: string[];
  buildings: Record<string, Building>;
  extras: Extras;
};

export const EMPTY_PROFILE: Profile = { xp: 0, stars: 0, streak: 0, last_day: null, claimed_day: null, claimed: [], buildings: {}, extras: EMPTY_EXTRAS };
const mergeExtras = (e: any): Extras => ({ ...EMPTY_EXTRAS, ...(e && typeof e === 'object' ? e : {}) });

const NOTICE_TARGET: Record<string, { href: string; label: string }> = {
  審核通知: { href: '/review?tab=portal-requests', label: '家長／學生帳號申請' },
  請假申請: { href: '/review?tab=student-leave', label: '學生請假申請' },
  學籍異動申請: { href: '/review?tab=status-requests', label: '學籍異動申請' },
  學生資料變更: { href: '/review?tab=profile', label: '學生資料變更' },
  個資修改申請: { href: '/review?tab=profile', label: '個資修改申請' },
  考場通知: { href: '/exam-rosters', label: '考場名冊' },
  代課通知: { href: '/notifications', label: '代課通知' },
  出缺勤示警: { href: '/notifications', label: '出缺勤示警' },
};

export const XP_ROLLCALL = 20;
export const XP_NOTICE = 15;

// ---- 臺北時間 ----
export function taipeiDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function weekdayOf(day: string): number {
  return new Date(day + 'T00:00:00Z').getUTCDay() || 7;
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000);
}

// ---- 等級 ----
export function levelOf(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
}
export function levelRange(lv: number): { from: number; to: number } {
  return { from: 50 * (lv - 1) ** 2, to: 50 * lv ** 2 };
}
const TITLES: [number, string][] = [[1, '見習老師'], [3, '新手導師'], [5, '熱血教師'], [8, '資深導師'], [12, '校園英雄'], [16, '傳奇人物']];
export function titleOf(lv: number): string {
  let t = TITLES[0][1];
  for (const [min, name] of TITLES) if (lv >= min) t = name;
  return t;
}

// ---- 任務 ----
export async function loadQuests(teacherId: string): Promise<Quest[]> {
  const today = taipeiDay();
  const weekday = weekdayOf(today);
  const quests: Quest[] = [];

  // 點名：自己任課的節次（扣掉被代課走的），加上今天代課進來的節次
  const term = await resolveCurrentTerm();
  let sq = supabase.from('class_schedule').select('period_no, subject, class_id').eq('teacher_id', teacherId).eq('weekday', weekday);
  if (term) sq = sq.eq('academic_year', term.academic_year).eq('term', term.term);
  const [{ data: sched }, { data: subs }] = await Promise.all([
    sq,
    supabase
      .from('substitute_assignments')
      .select('class_id, period_no, subject, original_teacher_id, substitute_teacher_id')
      .eq('substitute_date', today)
      .in('status', ['已排定', '已完成'])
      .or(`original_teacher_id.eq.${teacherId},substitute_teacher_id.eq.${teacherId}`),
  ]);
  const away = new Set(
    (subs ?? []).filter((s: any) => s.original_teacher_id === teacherId && s.substitute_teacher_id && s.substitute_teacher_id !== teacherId).map((s: any) => `${s.class_id}-${s.period_no}`),
  );
  const rows: { class_id: string; period_no: number; subject: string; sub: boolean }[] = [
    ...(sched ?? []).filter((r: any) => r.period_no && !away.has(`${r.class_id}-${r.period_no}`)).map((r: any) => ({ class_id: r.class_id, period_no: r.period_no, subject: r.subject, sub: false })),
    ...(subs ?? [])
      .filter((s: any) => s.substitute_teacher_id === teacherId && !(sched ?? []).some((r: any) => r.class_id === s.class_id && r.period_no === s.period_no))
      .map((s: any) => ({ class_id: s.class_id, period_no: s.period_no, subject: s.subject, sub: true })),
  ].sort((a, b) => a.period_no - b.period_no);

  if (rows.length > 0) {
    const classIds = Array.from(new Set(rows.map((r) => r.class_id)));
    const [{ data: classes }, { data: calls }] = await Promise.all([
      supabase.from('classes').select('id, grade_level, class_name').in('id', classIds),
      supabase.from('attendance_roll_calls').select('class_id, period_no').eq('record_date', today).in('class_id', classIds),
    ]);
    const label = new Map<string, string>((classes ?? []).map((c: any) => [c.id, `${c.grade_level}${c.class_name}`]));
    const called = new Set((calls ?? []).map((c: any) => `${c.class_id}-${c.period_no}`));
    for (const r of rows) {
      quests.push({
        key: `rc:${r.class_id}:${r.period_no}`,
        kind: 'rollcall',
        title: `第 ${r.period_no} 節 點名（${label.get(r.class_id) ?? '班級'}）`,
        sub: r.sub ? `${r.subject} · 代課` : r.subject,
        xp: XP_ROLLCALL,
        done: called.has(`${r.class_id}-${r.period_no}`),
        href: '/attendance/mobile',
      });
    }
  }

  // 打卡：有對應到打卡機代碼的教職員，平日（非放假）才有上班／下班兩個任務
  if (weekday <= 5) {
    try {
      const [{ data: emp }, { data: hol }] = await Promise.all([
        supabase.from('clock_employee_map').select('device_code').eq('teacher_id', teacherId).eq('active', true).limit(1),
        supabase.from('clock_holidays').select('holiday_date').eq('holiday_date', today).limit(1),
      ]);
      const code = emp?.[0]?.device_code;
      if (code != null && !(hol && hol.length)) {
        const { data: recs } = await supabase.from('clock_records').select('punched_at, voided').eq('device_code', code).eq('punch_date', today).order('punched_at');
        const times = (recs ?? []).filter((r: any) => !r.voided).map((r: any) => new Date(r.punched_at).getTime());
        const hhmm = (t: number) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
        const hasIn = times.length > 0;
        const hasOut = times.length > 1 && times[times.length - 1] - times[0] >= 3 * 3600000;
        quests.unshift(
          { key: `ck-in:${today}`, kind: 'clock', title: '上班打卡', sub: hasIn ? `${hhmm(times[0])} 已打卡` : '今天還沒有打卡紀錄', xp: 10, done: hasIn, href: '/clock' },
          { key: `ck-out:${today}`, kind: 'clock', title: '下班打卡', sub: hasOut ? `${hhmm(times[times.length - 1])} 已打卡` : '下班時記得打卡', xp: 10, done: hasOut, href: '/clock' },
        );
      }
    } catch {
      /* 打卡資料讀不到就不出打卡任務，不影響其他任務 */
    }
  }

  // 通知：未讀的是「新任務」，今天已讀的算完成
  const startOfToday = `${today}T00:00:00+08:00`;
  const [{ data: unread }, { data: handled }] = await Promise.all([
    supabase.from('staff_notifications').select('id, category, created_at').eq('teacher_id', teacherId).is('read_at', null).order('created_at', { ascending: false }).limit(20),
    supabase.from('staff_notifications').select('id, category, created_at').eq('teacher_id', teacherId).gte('read_at', startOfToday).limit(20),
  ]);
  const mk = (n: any, done: boolean): Quest => {
    const t = NOTICE_TARGET[n.category] ?? { href: '/notifications', label: n.category };
    return { key: `nt:${n.id}`, kind: 'notice', title: t.label, sub: done ? '今天已處理' : '新任務', xp: XP_NOTICE, done, href: t.href };
  };
  for (const n of unread ?? []) quests.push(mk(n, false));
  for (const n of handled ?? []) quests.push(mk(n, true));
  return quests;
}

// ---- 玩家進度：優先存資料庫，沒建表就退回這台瀏覽器 ----
const localKey = (id: string) => `game_profile_${id}`;
function localExtras(id: string): any {
  try {
    const raw = localStorage.getItem(localKey(id));
    return raw ? JSON.parse(raw).extras : null;
  } catch {
    return null;
  }
}

export async function loadProfile(teacherId: string): Promise<{ profile: Profile; remote: boolean }> {
  try {
    const { data, error } = await supabase.from('game_profiles').select('*').eq('teacher_id', teacherId).maybeSingle();
    if (!error) {
      if (!data) return { profile: { ...EMPTY_PROFILE }, remote: true };
      return {
        remote: true,
        profile: {
          xp: data.xp ?? 0,
          stars: data.stars ?? 0,
          streak: data.streak ?? 0,
          last_day: data.last_day ?? null,
          claimed_day: data.claimed_day ?? null,
          claimed: Array.isArray(data.claimed) ? data.claimed : [],
          buildings: data.buildings && typeof data.buildings === 'object' ? data.buildings : {},
          // 資料庫還沒有 extras 欄位時，用這台裝置暫存的
          extras: mergeExtras(data.extras ?? localExtras(teacherId)),
        },
      };
    }
  } catch {
    /* 退回本機 */
  }
  try {
    const raw = localStorage.getItem(localKey(teacherId));
    if (raw) {
      const j = JSON.parse(raw);
      return { profile: { ...EMPTY_PROFILE, ...j, extras: mergeExtras(j.extras) }, remote: false };
    }
  } catch {
    /* 略過 */
  }
  return { profile: { ...EMPTY_PROFILE }, remote: false };
}

// 讀本機暫存的進度（不查資料庫）：上方狀態列與各頁的小夥伴用它，換頁不增加任何查詢
export function peekProfile(teacherId: string): Profile | null {
  try {
    const raw = localStorage.getItem(localKey(teacherId));
    if (!raw) return null;
    const j = JSON.parse(raw);
    return { ...EMPTY_PROFILE, ...j, extras: mergeExtras(j.extras) };
  } catch {
    return null;
  }
}

export const PROFILE_EVENT = 'game-profile-update';

// 今天任務完成幾個／共幾個，存在這個分頁的 sessionStorage，給狀態列顯示
export function saveQuestSummary(teacherId: string, quests: Quest[]) {
  try {
    sessionStorage.setItem(`game_quests_${teacherId}`, JSON.stringify({ done: quests.filter((q) => q.done).length, total: quests.length, at: Date.now() }));
  } catch {
    /* 略過 */
  }
}
export function peekQuestSummary(teacherId: string): { done: number; total: number } | null {
  try {
    const raw = sessionStorage.getItem(`game_quests_${teacherId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// 查一次任務、領經驗值並存檔（給「在其他頁面完成任務也會算」用，呼叫端自己控制頻率）
export async function syncGame(teacherId: string): Promise<{ profile: Profile; gained: number; levelUp: boolean }> {
  const [{ profile: loaded, remote }, quests] = await Promise.all([loadProfile(teacherId), loadQuests(teacherId)]);
  const res = claim(loaded, quests);
  saveQuestSummary(teacherId, quests);
  if (res.profile !== loaded) await saveProfile(teacherId, res.profile, remote);
  else window.dispatchEvent(new CustomEvent(PROFILE_EVENT));
  return res;
}

export async function saveProfile(teacherId: string, p: Profile, remote: boolean): Promise<void> {
  // 一律在本機留一份（資料庫缺 extras 欄位時，寵物與花園靠這份）
  try {
    localStorage.setItem(localKey(teacherId), JSON.stringify(p));
    window.dispatchEvent(new CustomEvent(PROFILE_EVENT));
  } catch {
    /* 略過 */
  }
  if (remote) {
    const row = { teacher_id: teacherId, ...p, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('game_profiles').upsert(row);
    if (error) {
      const { extras: _x, ...core } = row;
      await supabase.from('game_profiles').upsert(core);
    }
  }
}

// 把「今天剛完成、還沒領過」的任務換成經驗值與星星，並更新連勝。
// 連勝：隔了 3 天以內（含週末）都算接續；超過就從 1 重新開始，不扣分。
export function claim(p: Profile, quests: Quest[]): { profile: Profile; gained: number; levelUp: boolean } {
  const today = taipeiDay();
  const base: Profile = p.claimed_day === today ? p : { ...p, claimed_day: today, claimed: [] };
  const fresh = quests.filter((q) => q.done && !base.claimed.includes(q.key));
  if (fresh.length === 0) return { profile: base, gained: 0, levelUp: false };
  const gained = fresh.reduce((s, q) => s + q.xp, 0);
  let streak = base.streak;
  if (base.last_day !== today) streak = base.last_day && daysBetween(base.last_day, today) <= 3 ? streak + 1 : 1;
  const next: Profile = {
    ...base,
    xp: base.xp + gained,
    stars: base.stars + gained,
    streak,
    last_day: today,
    claimed: [...base.claimed, ...fresh.map((q) => q.key)],
    extras: { ...base.extras, food: base.extras.food + gained },
  };
  return { profile: next, gained, levelUp: levelOf(next.xp) > levelOf(base.xp) };
}

// ---- 經營：建築 ----
export const BUILDINGS = [
  { key: 'classroom', name: '教室', icon: '🏫', desc: '點名' },
  { key: 'office', name: '辦公室', icon: '🏢', desc: '審核與通知' },
  { key: 'gate', name: '大廳', icon: '🚪', desc: '訪客接待' },
] as const;
export const IDLE_CAP_HOURS = 8;
export const perHour = (lv: number) => lv * 3;
export const upgradeCost = (lv: number) => 40 * lv;
export function pending(b: Building, now: number): number {
  const hours = Math.min(IDLE_CAP_HOURS, Math.max(0, (now - b.t) / 3600000));
  return Math.floor(hours * perHour(b.lv));
}

// ---- RPG：寵物 ----
// 每次任務完成換同樣數量的「飼料」，拿去餵寵物；XP 只增不減（決定等級），不會因為餵食倒退。
export type Species = { key: string; name: string; emoji: string; unlock: number; hello: string[] };
export const SPECIES: Species[] = [
  { key: 'chick', name: '小雞', emoji: '🐥', unlock: 1, hello: ['啾啾！', '今天也要加油喔', '我肚子有點餓～'] },
  { key: 'cat', name: '小貓', emoji: '🐱', unlock: 1, hello: ['喵～', '摸摸我就有精神了', '點名完了嗎？'] },
  { key: 'dog', name: '小狗', emoji: '🐶', unlock: 3, hello: ['汪汪！', '我陪你上課', '散步時間到了嗎？'] },
  { key: 'rabbit', name: '兔兔', emoji: '🐰', unlock: 5, hello: ['蹦蹦跳跳', '你辛苦了', '想吃紅蘿蔔'] },
  { key: 'fox', name: '狐狸', emoji: '🦊', unlock: 8, hello: ['嘿嘿，我看到你很認真', '今天的任務很順利', '本狐很滿意'] },
  { key: 'panda', name: '熊貓', emoji: '🐼', unlock: 12, hello: ['慢慢來，不急', '吃竹子，休息一下', '你很棒'] },
  { key: 'unicorn', name: '獨角獸', emoji: '🦄', unlock: 16, hello: ['閃閃發光', '你是傳說級老師', '魔法加持中'] },
];
export const STAGES: { min: number; label: string; size: number }[] = [
  { min: 0, label: '蛋', size: 34 },
  { min: 30, label: '幼崽', size: 34 },
  { min: 100, label: '成長期', size: 46 },
  { min: 250, label: '完全體', size: 58 },
];
export const FEED_AMOUNT = 10;
export function stageOf(fed: number): number {
  let s = 0;
  STAGES.forEach((st, i) => {
    if (fed >= st.min) s = i;
  });
  return s;
}

// ---- 經營：花園 ----
// 等待是免費的、加速要花星星，所以放著不管也一定賺；澆水／施肥只是用星星換時間。
export type PlantDef = { key: string; name: string; flower: string; fruit: string; seed: number; hours: number; reward: number };
export const PLANTS: PlantDef[] = [
  { key: 'sunflower', name: '向日葵', flower: '🌻', fruit: '🌻', seed: 10, hours: 4, reward: 18 },
  { key: 'strawberry', name: '草莓', flower: '🌸', fruit: '🍓', seed: 15, hours: 6, reward: 30 },
  { key: 'tomato', name: '番茄', flower: '🌼', fruit: '🍅', seed: 20, hours: 8, reward: 42 },
  { key: 'lavender', name: '薰衣草', flower: '🪻', fruit: '🪻', seed: 25, hours: 10, reward: 55 },
  { key: 'apple', name: '蘋果樹', flower: '🌸', fruit: '🍎', seed: 40, hours: 16, reward: 95 },
];
export const WATER_COST = 3;
export const WATER_HOURS = 1;
export const FERT_COST = 10;
export const FERT_HOURS = 4;
export const MAX_PLOTS = 6;
export const plotCost = (count: number) => 50 * (count - 1);
export function plantProgress(pl: Plot, def: PlantDef, now: number): number {
  const hours = Math.max(0, (now - pl.t) / 3600000) + pl.bonus;
  return Math.min(1, hours / def.hours);
}
export function plantStage(def: PlantDef, p: number): { e: string; size: number; label: string } {
  if (p >= 1) return { e: def.fruit, size: 44, label: '可收成' };
  if (p >= 0.75) return { e: def.flower, size: 38, label: '開花' };
  if (p >= 0.5) return { e: '🪴', size: 32, label: '花苞' };
  if (p >= 0.25) return { e: '🌿', size: 28, label: '長葉' };
  return { e: '🌱', size: 24, label: '發芽' };
}

'use client';

import { supabase } from '@/lib/supabaseClient';
import { resolveCurrentTerm } from '@/lib/academicTerm';

// 遊戲化面板的資料層。任務一律由既有資料表即時推導（課表、點名紀錄、通知），
// 只有「玩家進度」（經驗值、星星、連勝、建築）另存。只在載入面板、切回分頁時查詢，不輪詢。

export type Quest = {
  key: string;
  kind: 'rollcall' | 'notice';
  title: string;
  sub?: string;
  xp: number;
  done: boolean;
  href: string;
};

export type Building = { lv: number; t: number };
export type Profile = {
  xp: number;
  stars: number;
  streak: number;
  last_day: string | null;
  claimed_day: string | null;
  claimed: string[];
  buildings: Record<string, Building>;
};

export const EMPTY_PROFILE: Profile = { xp: 0, stars: 0, streak: 0, last_day: null, claimed_day: null, claimed: [], buildings: {} };

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
        },
      };
    }
  } catch {
    /* 退回本機 */
  }
  try {
    const raw = localStorage.getItem(localKey(teacherId));
    if (raw) return { profile: { ...EMPTY_PROFILE, ...JSON.parse(raw) }, remote: false };
  } catch {
    /* 略過 */
  }
  return { profile: { ...EMPTY_PROFILE }, remote: false };
}

export async function saveProfile(teacherId: string, p: Profile, remote: boolean): Promise<void> {
  if (remote) {
    const { error } = await supabase.from('game_profiles').upsert({ teacher_id: teacherId, ...p, updated_at: new Date().toISOString() });
    if (!error) return;
  }
  try {
    localStorage.setItem(localKey(teacherId), JSON.stringify(p));
  } catch {
    /* 略過 */
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

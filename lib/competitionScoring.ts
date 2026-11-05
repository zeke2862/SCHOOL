// 競賽：型別、標籤與計分/排名邏輯（純函式，前後端都能用，也有單元測試：tools/competition-sql-test/scoring.test.mjs）
// 沿用舊競賽系統的規則：評審制=各評審總分相加；象棋=勝3和1敗0；名次並列時同名次、下一名次跳號（1,2,2,4）。

export type ScoreType = 'judge' | 'test' | 'chess' | 'record' | 'vote';

export const SCORE_TYPE_LABEL: Record<ScoreType, string> = {
  judge: '評審評分制',
  test: '測驗成績制',
  chess: '勝敗制（象棋、對戰）',
  record: '紀錄制（秒數、距離）',
  vote: '作品投票制',
};

export const EVENT_STATUS_LABEL: Record<string, string> = {
  draft: '草稿（只有承辦人看得到）',
  open: '開放報名',
  closed: '報名截止',
  running: '比賽中',
  finished: '已結束',
};
export const EVENT_STATUS_ORDER = ['draft', 'open', 'closed', 'running', 'finished'] as const;

// 學校實際使用的年級文字（與 lib/gradeMapping.ts 一致）
export const GRADE_CHOICES = ['幼甲', '幼乙', '1年', '2年', '3年', '4年', '5年', '6年', '初一', '初二', '初三', '高一', '高二', '高三'];

// 建立賽事時可一鍵帶入的常用組別（年級分組可再自行勾選修改）
export const GROUP_PRESETS: { code: string; name: string; grades: string[]; teacherOnly?: boolean }[] = [
  { code: 'A', name: '教師組', grades: [], teacherOnly: true },
  { code: 'B', name: '高中組', grades: ['高一', '高二', '高三'] },
  { code: 'C', name: '初中組', grades: ['初一', '初二', '初三'] },
  { code: 'D', name: '小學甲組', grades: ['4年', '5年', '6年'] },
  { code: 'E', name: '小學乙組', grades: ['1年', '2年', '3年'] },
];

export type CompEvent = {
  id: string; title: string; description: string | null; scope: 'internal' | 'external'; status: string;
  academic_year: number | null; term: string | null; reg_open_at: string | null; reg_close_at: string | null;
  public_enabled: boolean; public_token: string; config: Record<string, any>; created_by: string; created_at: string;
};
export type CompGroup = { id: string; event_id: string; code: string; name: string; grade_levels: string[]; teacher_only: boolean; sort_no: number };
export type Criterion = { label: string; weight: string };
export type CompItem = {
  id: string; event_id: string; group_id: string; code: string; name: string; score_type: ScoreType; judge_count: number;
  criteria: Criterion[]; quota: number | null; config: Record<string, any>; revision: number;
  published_at: string | null; sort_no: number;
};
export type CompReg = {
  id: string; event_id: string; item_id: string; kind: 'student' | 'teacher' | 'external'; student_no: string | null;
  teacher_user_id: string | null; display_name: string; school_name: string | null; grade_label: string | null;
  diet: string | null; draw_number: string | null; status: 'registered' | 'withdrawn'; created_at: string;
};
export type CompScore = { id?: string; item_id: string; registration_id: string; judge_user_id: string | null; raw: Record<string, any>; total: number | null; submitted: boolean };
export type CompResult = { item_id: string; registration_id: string; total: number | null; rank: number | null; award: string | null };

export type Computed = { registration_id: string; total: number | null; rank: number | null; judgeTotals?: number[] };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 象棋/對戰：贏 3、和 1、輸 0。三格都空白回傳 null（代表還沒輸入）。 */
export function chessPoints(raw: Record<string, any> | null | undefined): number | null {
  if (!raw) return null;
  const w = num(raw.wins), l = num(raw.losses), d = num(raw.draws);
  if (w === null && l === null && d === null) return null;
  return (w ?? 0) * 3 + (d ?? 0);
}

/** 評審制：把各評審的總分相加；dropHighLow=true 且評審 ≥3 位時，去掉一個最高、一個最低。 */
export function sumJudgeTotals(totals: number[], dropHighLow = false): number | null {
  if (totals.length === 0) return null;
  let t = [...totals];
  if (dropHighLow && t.length >= 3) {
    t.sort((a, b) => a - b);
    t = t.slice(1, -1);
  }
  return Math.round(t.reduce((a, b) => a + b, 0) * 100) / 100;
}

/** 依各項目的計分方式算出每位選手的總分與名次。votes：作品投票用，registration_id → 票數。 */
export function computeRanking(
  item: Pick<CompItem, 'score_type' | 'config'>,
  regs: Pick<CompReg, 'id'>[],
  scores: Pick<CompScore, 'registration_id' | 'judge_user_id' | 'raw' | 'total'>[],
  votes?: Record<string, number>
): Computed[] {
  const rows: Computed[] = regs.map((r) => {
    const mine = scores.filter((s) => s.registration_id === r.id);
    let total: number | null = null;
    let judgeTotals: number[] | undefined;
    switch (item.score_type) {
      case 'judge': {
        judgeTotals = mine.filter((s) => s.judge_user_id && s.total !== null && s.total !== undefined).map((s) => Number(s.total));
        total = sumJudgeTotals(judgeTotals, !!item.config?.drop_high_low);
        break;
      }
      case 'test': {
        const s = mine.find((x) => !x.judge_user_id);
        total = s ? num(s.total ?? s.raw?.score) : null;
        break;
      }
      case 'chess': {
        const s = mine.find((x) => !x.judge_user_id);
        total = s ? chessPoints(s.raw) : null;
        break;
      }
      case 'record': {
        const s = mine.find((x) => !x.judge_user_id);
        total = s ? num(s.total ?? s.raw?.value) : null;
        break;
      }
      case 'vote':
        total = votes ? votes[r.id] ?? 0 : null;
        break;
    }
    return { registration_id: r.id, total, rank: null, judgeTotals };
  });

  const asc = item.score_type === 'record' && item.config?.record_order === 'asc';
  const ranked = rows.filter((r) => r.total !== null).sort((a, b) => (asc ? a.total! - b.total! : b.total! - a.total!));
  let prev: number | null = null;
  let prevRank = 0;
  ranked.forEach((r, i) => {
    if (prev !== null && r.total === prev) r.rank = prevRank;
    else { r.rank = i + 1; prevRank = r.rank; prev = r.total; }
  });
  return rows;
}

/** 依名次建議獎項（承辦人可在公布前手動改）：前三名「第N名」，第 4～6 名「佳作」。 */
export function suggestAward(rank: number | null, rules?: { top?: number; honorableUntil?: number }): string {
  if (!rank) return '';
  const top = rules?.top ?? 3;
  const hm = rules?.honorableUntil ?? 6;
  if (rank <= top) return `第${rank}名`;
  if (rank <= hm) return '佳作';
  return '';
}

/** 評分準則（一行一項：「名稱|配分」或「名稱 配分%」）轉陣列，給設定畫面用 */
export function parseCriteria(text: string): Criterion[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [label, weight] = l.split(/[|｜]/).map((s) => s.trim());
    return { label: label || l, weight: weight ?? '' };
  });
}
export const criteriaToText = (c: Criterion[]) => c.map((x) => (x.weight ? `${x.label}|${x.weight}` : x.label)).join('\n');

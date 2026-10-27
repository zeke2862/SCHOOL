import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireDevOrSystemAdmin } from '@/lib/devAuth';

// ============================================================
// 課表資料整理：找出（並清掉）「任課教師設定」重複列
// ------------------------------------------------------------
// 背景：class_schedule 裡 weekday / period_no 為空的列，代表「這個班這一科由誰教」（任課教師設定）。
// 舊版上傳程式在找既有列時用 maybeSingle()，一旦同一班同一科已經有 2 筆以上，
// maybeSingle() 會回傳錯誤、被當成「沒有找到」，於是又再新增一筆——
// 每上傳一次就多一筆，越積越多（實際備份檔裡同一班同一科最多重複了 13 筆）。
// 這裡只刪「完全相同」（同班、同學年、同學期、同科目、同老師、都沒有星期節次）的多餘列，
// 每組保留 id 最小的那 1 筆，不會碰到有排星期節次的正式課表。
//
// POST { action: 'scan' }  → 只統計、不改資料
// POST { action: 'apply' } → 刪除多餘列，回傳刪了幾筆
// ============================================================
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const PAGE = 1000;

async function loadAllSchedule() {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('class_schedule')
      .select('id, class_id, academic_year, term, weekday, period_no, subject, teacher_id')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error('讀取課表失敗：' + error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireDevOrSystemAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: NextResponse }).res;
    const body = await req.json().catch(() => ({} as any));
    const action = String(body?.action ?? 'scan');

    const rows = await loadAllSchedule();
    const nullRows = rows.filter((r) => r.weekday == null && r.period_no == null);
    const slotRows = rows.filter((r) => r.weekday != null && r.period_no != null);

    const groups = new Map<string, any[]>();
    for (const r of nullRows) {
      const key = [r.class_id, r.academic_year, r.term, r.subject, r.teacher_id].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const dupGroups = [...groups.values()].filter((g) => g.length > 1);
    const extraIds: string[] = [];
    for (const g of dupGroups) {
      const sorted = [...g].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      sorted.slice(1).forEach((r) => extraIds.push(r.id));
    }

    if (action === 'scan') {
      // 補上班級／教師名稱讓畫面看得懂
      const [{ data: classes }, { data: teachers }] = await Promise.all([
        supabaseAdmin.from('classes').select('id, grade_level, class_name'),
        supabaseAdmin.from('teachers').select('id, name'),
      ]);
      const cl = new Map((classes ?? []).map((c: any) => [c.id, `${c.grade_level}${c.class_name}`]));
      const tn = new Map((teachers ?? []).map((t: any) => [t.id, t.name]));
      const detail = dupGroups
        .map((g) => ({
          cls: cl.get(g[0].class_id) ?? g[0].class_id,
          academicYear: g[0].academic_year,
          term: g[0].term,
          subject: g[0].subject,
          teacher: tn.get(g[0].teacher_id) ?? g[0].teacher_id,
          copies: g.length,
        }))
        .sort((a, b) => b.copies - a.copies);

      // 順便提醒：有排星期節次，但沒有對應「任課教師設定」的組合（資料來源不一致，不會自動修改）
      const nullKeys = new Set(nullRows.map((r) => [r.class_id, r.academic_year, r.term, r.subject, r.teacher_id].join('|')));
      const slotKeys = new Set(slotRows.map((r) => [r.class_id, r.academic_year, r.term, r.subject, r.teacher_id].join('|')));
      const onlyInSlots = [...slotKeys].filter((k) => !nullKeys.has(k)).length;
      const onlyInAssign = [...nullKeys].filter((k) => !slotKeys.has(k)).length;

      return NextResponse.json({
        totalRows: rows.length,
        assignmentRows: nullRows.length,
        distinctAssignments: groups.size,
        duplicateGroups: dupGroups.length,
        extraRows: extraIds.length,
        slotRows: slotRows.length,
        onlyInSlots,
        onlyInAssign,
        detail: detail.slice(0, 300),
      });
    }

    if (action === 'apply') {
      let deleted = 0;
      for (let i = 0; i < extraIds.length; i += 200) {
        const chunk = extraIds.slice(i, i + 200);
        const { error } = await supabaseAdmin.from('class_schedule').delete().in('id', chunk);
        if (error) {
          return NextResponse.json({ error: `刪到一半失敗（已刪 ${deleted} 筆）：${error.message}`, deleted }, { status: 500 });
        }
        deleted += chunk.length;
      }
      return NextResponse.json({ deleted });
    }

    return NextResponse.json({ error: '不認得的 action：' + action }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

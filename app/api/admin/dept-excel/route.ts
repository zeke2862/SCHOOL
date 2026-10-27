import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireDevOrSystemAdmin } from '@/lib/devAuth';
import { TABLE_DEFS, type TableDef } from '@/lib/deptTableDefs';

// ============================================================
// 四部門 Excel 一鍵下載／上傳 的伺服器端 API（只有系統管理員S或開發人員部門可用）
// ------------------------------------------------------------
// 為什麼要走伺服器：
// 1. 「完整所有資料」包含被 RLS 隱藏的資料（例如休學／退學學生、別人的通知），
//    用一般登入身分的前端連線查不到；伺服器用 service role 才查得完整。
// 2. 上傳時會寫入很多張表，有些表的 RLS 只允許特定部門寫入；已經在這裡確認過
//    「呼叫者是開發人員／系統管理員S」，所以用 service role 統一寫入。
// 請求格式（POST，JSON）：
//   { action: 'count',   tables: string[] }
//   { action: 'page',    table, offset, limit, total?, exceptionsOnly? }
//   { action: 'lookups' }
//   { action: 'import',  table, onConflict: string | null, rows: object[] }
// ============================================================
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const DEF_BY_TABLE = new Map<string, TableDef>(TABLE_DEFS.map((d) => [d.table, d]));
const PAGE = 1000;
const MAX_PAGE_LIMIT = 5000;
const MAX_RESPONSE_BYTES = 3_000_000; // 平台單次回應上限約 4.5MB，留餘裕

function errMsg(e: any): string {
  return e?.message || e?.details || e?.hint || (typeof e === 'string' ? e : JSON.stringify(e)) || '未知錯誤';
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireDevOrSystemAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: NextResponse }).res;

    const body = await req.json().catch(() => ({} as any));
    const action = String(body?.action ?? '');

    // ---------- 筆數 ----------
    if (action === 'count') {
      const tables: string[] = Array.isArray(body.tables) ? body.tables : [];
      const counts: Record<string, number | null> = {};
      const exceptions: Record<string, number | null> = {};
      await Promise.all(
        tables.map(async (t) => {
          if (!DEF_BY_TABLE.has(t)) return;
          const { count, error } = await supabaseAdmin.from(t).select('*', { count: 'exact', head: true });
          counts[t] = error ? null : count ?? 0;
          if (t === 'attendance' && !error) {
            const r = await supabaseAdmin.from(t).select('*', { count: 'exact', head: true }).neq('status', '出席');
            exceptions[t] = r.error ? null : r.count ?? 0;
          }
        })
      );
      return NextResponse.json({ counts, exceptions });
    }

    // ---------- 分頁讀取 ----------
    if (action === 'page') {
      const def = DEF_BY_TABLE.get(String(body.table));
      if (!def) return NextResponse.json({ error: '不認得的資料表：' + body.table }, { status: 400 });
      const offset = Math.max(0, Number(body.offset) || 0);
      const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Number(body.limit) || 1000));
      const total = body.total != null ? Number(body.total) : null;
      const exceptionsOnly = !!body.exceptionsOnly && def.table === 'attendance';

      const rows: any[] = [];
      let from = offset;
      let bytes = 0;
      let full = false; // 回應快要超過平台單次回應大小上限時，提早結束，讓前端用 nextOffset 接著要
      while (rows.length < limit && !full) {
        let q = supabaseAdmin.from(def.table).select('*');
        if (exceptionsOnly) q = q.neq('status', '出席');
        for (const k of def.pk) q = q.order(k, { ascending: true });
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) return NextResponse.json({ error: `讀取 ${def.table} 失敗：${errMsg(error)}` }, { status: 500 });
        if (!data || data.length === 0) break;
        for (const r of data) {
          const size = JSON.stringify(r).length;
          if (rows.length > 0 && bytes + size > MAX_RESPONSE_BYTES) {
            full = true;
            break;
          }
          rows.push(r);
          bytes += size;
          from++;
        }
        if (full) break;
        if (total != null && from >= total) break;
        if (data.length < PAGE && total == null) break;
      }
      const trimmed = rows.slice(0, limit);
      return NextResponse.json({ rows: trimmed, nextOffset: offset + trimmed.length });
    }

    // ---------- 對照表（學號→姓名、班級、教師、帳號…，只用來產生「〔參考〕」欄） ----------
    if (action === 'lookups') {
      const all = async (table: string, cols: string, orderCol: string) => {
        const out: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabaseAdmin.from(table).select(cols).order(orderCol).range(from, from + PAGE - 1);
          if (error || !data || data.length === 0) break;
          out.push(...data);
          if (data.length < PAGE) break;
        }
        return out;
      };
      const [students, classes, teachers, users, enrollments, clubs] = await Promise.all([
        all('students', 'student_no, name', 'student_no'),
        all('classes', 'id, department, grade_level, class_name', 'id'),
        all('teachers', 'id, name', 'id'),
        all('app_users', 'id, name', 'id'),
        all('enrollments', 'id, student_no, class_id', 'id'),
        all('clubs', 'id, name', 'id'),
      ]);
      const studentName: Record<string, string> = {};
      students.forEach((s: any) => (studentName[s.student_no] = s.name));
      const classLabel: Record<string, string> = {};
      classes.forEach((c: any) => (classLabel[c.id] = `${c.grade_level ?? ''}${c.class_name ?? ''}`));
      const teacherName: Record<string, string> = {};
      teachers.forEach((t: any) => (teacherName[t.id] = t.name));
      const userName: Record<string, string> = {};
      users.forEach((u: any) => (userName[u.id] = u.name));
      const enrollmentLabel: Record<string, string> = {};
      enrollments.forEach((e: any) => (enrollmentLabel[e.id] = `${e.student_no} ${studentName[e.student_no] ?? ''}／${classLabel[e.class_id] ?? ''}`));
      const clubName: Record<string, string> = {};
      clubs.forEach((c: any) => (clubName[c.id] = c.name));

      // 帳號信箱存在 Supabase Auth，不在 app_users 表
      const emailById: Record<string, string> = {};
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error || !data?.users?.length) break;
        (data.users as any[]).forEach((u) => (emailById[u.id] = u.email ?? ''));
        if (data.users.length < 1000) break;
      }
      return NextResponse.json({ studentName, classLabel, teacherName, userName, enrollmentLabel, clubName, emailById });
    }

    // ---------- 寫入（新增＋更新，不刪除） ----------
    if (action === 'import') {
      const def = DEF_BY_TABLE.get(String(body.table));
      if (!def) return NextResponse.json({ error: '不認得的資料表：' + body.table }, { status: 400 });
      if (def.mode !== 'normal') {
        return NextResponse.json({ error: `${def.table} 屬於「只供下載」的資料表，不能從 Excel 上傳` }, { status: 400 });
      }
      const rowsIn: any[] = Array.isArray(body.rows) ? body.rows : [];
      if (rowsIn.length === 0) return NextResponse.json({ ok: 0, errors: [] });
      if (rowsIn.length > 5000) return NextResponse.json({ error: '一次最多 5000 列' }, { status: 400 });

      // onConflict 只接受「主鍵」或「這張表真正存在的唯一限制」，其他一律拒絕
      const allowed = [def.pk.join(','), ...def.uniques.map((u) => u.join(','))];
      const onConflict: string | null = body.onConflict == null ? null : String(body.onConflict);
      if (onConflict !== null && !allowed.includes(onConflict)) {
        return NextResponse.json({ error: 'onConflict 不合法：' + onConflict }, { status: 400 });
      }

      const known = new Set(def.cols.map((c) => c.name));
      const rows = rowsIn.map((r) => {
        const o: Record<string, any> = {};
        for (const [k, v] of Object.entries(r ?? {})) if (known.has(k)) o[k] = v;
        return o;
      });

      const errors: { index: number; message: string }[] = [];
      let okCount = 0;
      let budget = 400; // 最多再發幾次請求去逐筆找出壞資料，避免整份都壞時打爆資料庫

      const write = async (chunk: any[]) => {
        const q = onConflict
          ? supabaseAdmin.from(def.table).upsert(chunk, { onConflict, defaultToNull: false })
          : supabaseAdmin.from(def.table).insert(chunk, { defaultToNull: false });
        return q;
      };

      const run = async (start: number, end: number): Promise<void> => {
        const chunk = rows.slice(start, end);
        if (chunk.length === 0) return;
        budget--;
        const { error } = await write(chunk);
        if (!error) {
          okCount += chunk.length;
          return;
        }
        if (chunk.length === 1 || budget <= 0) {
          // 沒預算了或已縮到單筆：整段標成同一個錯誤
          for (let i = start; i < end; i++) errors.push({ index: i, message: errMsg(error) });
          return;
        }
        const mid = start + Math.floor((end - start) / 2);
        await run(start, mid);
        await run(mid, end);
      };
      await run(0, rows.length);

      return NextResponse.json({ ok: okCount, errors: errors.slice(0, 200), errorCount: errors.length });
    }

    return NextResponse.json({ error: '不認得的 action：' + action }, { status: 400 });
  } catch (e: any) {
    console.error('[dept-excel] failed:', e);
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireOrganizer, supabaseAdmin } from '@/lib/competitionServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 外校/外部參賽者名單匯入（只建檔留紀錄；他們不登入系統，成績靠 QR 公開頁查詢）。
//  GET                下載 Excel 範本（含「項目對照」工作表）
//  POST (multipart)   file=Excel。預設只檢查不寫入（預覽）；加 ?commit=1 才寫入，且「有任何錯誤就整批不寫」。

const MAX_ROWS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const HEADERS = ['項目代碼*', '姓名*', '學校*', '年級', '飲食', '抽籤號'];

function cellText(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join('').trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return String(o.result).trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v).trim();
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrganizer(req, params.id, { readOnly: true });
  if ('err' in ctx) return ctx.err;
  const { data: items } = await supabaseAdmin
    .from('comp_items').select('code, name, comp_groups(name, sort_no), sort_no').eq('event_id', params.id).neq('score_type', 'vote').order('sort_no');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('報名資料');
  ws.addRow(HEADERS);
  ws.getRow(1).font = { bold: true };
  ws.columns = [{ width: 12 }, { width: 16 }, { width: 24 }, { width: 10 }, { width: 10 }, { width: 10 }];
  ws.addRow(['（範例）B1', '王小明', '○○華文學校', '小學五年級', '葷食', '']);
  const ref = wb.addWorksheet('項目對照');
  ref.addRow(['項目代碼', '組別', '項目名稱']);
  ref.getRow(1).font = { bold: true };
  ref.columns = [{ width: 12 }, { width: 18 }, { width: 24 }];
  for (const i of items ?? []) ref.addRow([i.code, (i as any).comp_groups?.name ?? '', i.name]);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('外校名單匯入範本.xlsx')}`,
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrganizer(req, params.id);
  if ('err' in ctx) return ctx.err;
  const commit = req.nextUrl.searchParams.get('commit') === '1';
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: '請選擇 Excel 檔案' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: '檔案太大（上限 5MB）' }, { status: 400 });
    if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: '請使用 .xlsx 檔（可先下載範本）' }, { status: 400 });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.getWorksheet('報名資料') ?? wb.worksheets[0];
    if (!ws) return NextResponse.json({ error: '找不到工作表' }, { status: 400 });

    const { data: items } = await supabaseAdmin.from('comp_items').select('id, code, score_type').eq('event_id', params.id);
    const byCode = new Map((items ?? []).map((i) => [i.code.trim().toUpperCase(), i]));
    const { data: existing } = await supabaseAdmin
      .from('comp_registrations').select('item_id, display_name, school_name').eq('event_id', params.id).eq('status', 'registered');
    const seen = new Set((existing ?? []).map((r) => `${r.item_id}|${r.display_name}|${r.school_name ?? ''}`));

    const errors: { row: number; message: string }[] = [];
    const valid: any[] = [];
    let skippedDup = 0;
    let dataRows = 0;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return; // 標題列
      const code = cellText(row.getCell(1).value).replace(/^（範例）/, '').toUpperCase();
      const name = cellText(row.getCell(2).value);
      const school = cellText(row.getCell(3).value);
      if (!code && !name && !school) return;
      if (cellText(row.getCell(1).value).startsWith('（範例）')) return;
      dataRows++;
      if (dataRows > MAX_ROWS) return;
      if (!code || !name || !school) return void errors.push({ row: n, message: '項目代碼、姓名、學校為必填' });
      const item = byCode.get(code);
      if (!item) return void errors.push({ row: n, message: `找不到項目代碼「${code}」（請看「項目對照」工作表）` });
      if (item.score_type === 'vote') return void errors.push({ row: n, message: `「${code}」是作品投票項目，不能匯入選手` });
      const key = `${item.id}|${name}|${school}`;
      if (seen.has(key)) { skippedDup++; return; }
      seen.add(key);
      valid.push({
        event_id: params.id, item_id: item.id, kind: 'external', display_name: name, school_name: school,
        grade_label: cellText(row.getCell(4).value) || null, diet: cellText(row.getCell(5).value) || null,
        draw_number: cellText(row.getCell(6).value) || null,
      });
    });
    if (dataRows > MAX_ROWS) return NextResponse.json({ error: `一次最多 ${MAX_ROWS} 列，請分批匯入` }, { status: 400 });

    const summary = { totalRows: dataRows, newRows: valid.length, skippedDuplicates: skippedDup, errors };
    if (!commit) return NextResponse.json({ committed: false, ...summary });
    if (errors.length) return NextResponse.json({ committed: false, error: '有錯誤，整批未寫入，請修正後重新上傳', ...summary }, { status: 422 });
    if (!valid.length) return NextResponse.json({ committed: true, inserted: 0, ...summary });

    for (let i = 0; i < valid.length; i += 500) {
      const { error } = await ctx.db.from('comp_registrations').insert(valid.slice(i, i + 500));
      if (error) {
        return NextResponse.json({ error: `寫入失敗（已寫入前 ${i} 筆）：${error.message}`, ...summary }, { status: 500 });
      }
    }
    return NextResponse.json({ committed: true, inserted: valid.length, ...summary });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? '讀取檔案失敗' }, { status: 500 });
  }
}

import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { parseClockCsvText } from '@/lib/staffClock';

// 打卡機「雲端伺服器 ADMS」推送：機器每有人打卡就自己 POST 到 /iclock/cdata。
// ADMS 沒有密碼可驗證，所以只接受 Vercel 環境變數 CLOCK_ADMS_SERIALS（機器序號，逗號分隔）列出的機器。
// CLOCK_ADMS_MACHINE_NO：寫入的機器編號，預設 102（要跟 tools/clock-sync 的 machineNo 一樣，兩邊才會去重）。

export function allowedSerial(sn: string | null): boolean {
  if (!sn) return false;
  const list = (process.env.CLOCK_ADMS_SERIALS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.includes(sn)) {
    console.warn(`[adms] 拒絕未登記的機器序號：${sn}（要接受請加入 CLOCK_ADMS_SERIALS）`);
    return false;
  }
  return true;
}

export const textRes = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' } });

export function serialOf(req: NextRequest) {
  return new URL(req.url).searchParams.get('SN');
}

/** ATTLOG 每列：PIN \t 時間 \t 狀態 \t 驗證方式 \t ... 時間為機器本地時間（泰國 +7） */
export function attlogToCsv(text: string, machineNo: number): string {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const c = raw.split('\t');
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec((c[1] ?? '').trim());
    const pin = (c[0] ?? '').trim();
    if (!m || !/^\d+$/.test(pin)) continue;
    const dir = c[2]?.trim() === '1' ? 'C/Out' : 'C/In';
    const verify = c[3]?.trim() === '15' ? 'FACE' : 'FP';
    lines.push(`,"${pin}",${pin},${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]},${dir},${machineNo},,${verify},`);
  }
  return lines.join('\n');
}

export async function saveAttlog(body: string): Promise<{ received: number; inserted: number }> {
  const machineNo = Number(process.env.CLOCK_ADMS_MACHINE_NO ?? 102) || 102;
  const { rows } = parseClockCsvText(attlogToCsv(body, machineNo));
  if (rows.length === 0) return { received: 0, inserted: 0 };

  // 沒看過的機號：先建立人員對照（名字 ATTLOG 沒有，先用機號；每日同步不會覆蓋，可在人員對照自行改顯示名稱）
  const codes = Array.from(new Set(rows.map((r) => r.device_code)));
  const { data: existing } = await supabaseAdmin.from('clock_employee_map').select('device_code, device_name').in('device_code', codes);
  const known = new Map((existing ?? []).map((e: any) => [e.device_code as number, e.device_name as string]));
  const fresh = codes.filter((c) => !known.has(c));
  if (fresh.length) {
    await supabaseAdmin
      .from('clock_employee_map')
      .upsert(fresh.map((c) => ({ device_code: c, device_name: String(c) })), { onConflict: 'device_code', ignoreDuplicates: true });
  }
  // 已建檔的人，用對照表上的名字
  const data = rows.map((r) => ({ ...r, device_name: known.get(r.device_code) ?? r.device_name, source: 'sync' }));
  const { data: ins, error } = await supabaseAdmin
    .from('clock_records')
    .upsert(data, { onConflict: 'device_code,punched_at,machine_no', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(error.message);
  return { received: rows.length, inserted: ins?.length ?? 0 };
}

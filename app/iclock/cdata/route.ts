import { NextRequest } from 'next/server';
import { allowedSerial, saveAttlog, serialOf, textRes } from '@/lib/clockAdms';

// 打卡機 ADMS 推送接收端（說明見 lib/clockAdms.ts）。
export const dynamic = 'force-dynamic';

// 機器開機／定期來要設定：回傳要它即時推送打卡
export async function GET(req: NextRequest) {
  const sn = serialOf(req);
  if (!allowedSerial(sn)) return textRes('FORBIDDEN', 403);
  return textRes(
    [`GET OPTION FROM: ${sn}`, 'ErrorDelay=60', 'Delay=30', 'TransTimes=00:00;12:00', 'TransInterval=1', 'TransFlag=TransData AttLog', 'Realtime=1', 'Encrypt=0'].join('\n')
  );
}

export async function POST(req: NextRequest) {
  const sn = serialOf(req);
  if (!allowedSerial(sn)) return textRes('FORBIDDEN', 403);
  const table = new URL(req.url).searchParams.get('table');
  const body = await req.text();
  if (table !== 'ATTLOG') return textRes('OK'); // 操作紀錄、人員資料等不處理，回 OK 讓機器不要重送
  try {
    const r = await saveAttlog(body);
    return textRes(`OK: ${r.received}`);
  } catch (e: any) {
    console.error('[adms] 寫入失敗', e?.message ?? e);
    return textRes('ERROR', 500); // 機器收到錯誤會保留資料稍後重送
  }
}

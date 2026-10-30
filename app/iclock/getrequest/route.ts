import { NextRequest } from 'next/server';
import { allowedSerial, serialOf, textRes } from '@/lib/clockAdms';

// 機器定期來問「有沒有要執行的指令」：沒有
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!allowedSerial(serialOf(req))) return textRes('FORBIDDEN', 403);
  return textRes('OK');
}

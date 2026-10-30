import { NextRequest } from 'next/server';
import { allowedSerial, serialOf, textRes } from '@/lib/clockAdms';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!allowedSerial(serialOf(req))) return textRes('FORBIDDEN', 403);
  return textRes('OK');
}

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireOrganizer, supabaseAdmin } from '@/lib/competitionServer';

export const dynamic = 'force-dynamic';

// QR 公開成績頁的連結管理（承辦人）：
//  GET                         目前的代碼與是否開啟
//  POST {action:'enable'}      開啟公開頁
//  POST {action:'disable'}     關閉公開頁（舊 QR 碼立刻失效，之後重新開啟仍可用同一組代碼）
//  POST {action:'rotate'}      換一組新代碼（舊的 QR 碼作廢，用在 QR 碼外流時）；不會自動開啟
//  POST {action:'show_score', value:boolean}  公開頁是否顯示分數（預設只顯示名次與獎項）
// 公開頁網址 = /results/<token>（頁面之後做），資料來自 /api/public/competition/<token>。

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrganizer(req, params.id, { readOnly: true });
  if ('err' in ctx) return ctx.err;
  const { data, error } = await supabaseAdmin.from('comp_events').select('public_token, public_enabled, config').eq('id', params.id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    token: data.public_token, enabled: data.public_enabled, path: `/results/${data.public_token}`,
    showScore: !!(data.config as any)?.public_show_score,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrganizer(req, params.id);
  if ('err' in ctx) return ctx.err;
  const body = (await req.json()) as { action?: string; value?: boolean };
  let patch: Record<string, unknown>;
  if (body.action === 'enable') patch = { public_enabled: true };
  else if (body.action === 'disable') patch = { public_enabled: false };
  else if (body.action === 'rotate') patch = { public_token: randomBytes(32).toString('hex'), public_enabled: false };
  else if (body.action === 'show_score' && typeof body.value === 'boolean') {
    const { data } = await supabaseAdmin.from('comp_events').select('config').eq('id', params.id).single();
    patch = { config: { ...((data?.config as object) ?? {}), public_show_score: body.value } };
  } else return NextResponse.json({ error: '未知的動作' }, { status: 400 });

  // 用承辦人身分更新，讓 RLS 把關
  const { data, error } = await ctx.db.from('comp_events').update(patch).eq('id', params.id).select('public_token, public_enabled, config').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    token: data.public_token, enabled: data.public_enabled, path: `/results/${data.public_token}`,
    showScore: !!(data.config as any)?.public_show_score,
  });
}

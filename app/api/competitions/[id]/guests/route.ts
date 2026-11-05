import { NextRequest, NextResponse } from 'next/server';
import { requireOrganizer, findAuthUserIdByEmail, parseExpiry, auditGuest, isUuid, supabaseAdmin } from '@/lib/competitionServer';

export const dynamic = 'force-dynamic';

// 賽事訪客（外聘評審/裁判）：承辦人替「自己的賽事」建立、查詢、延長/停用、移除。
// 訪客帳號的 role 是 competition_guest：選單只有賽事，資料庫也擋掉所有其他資料表（sql/143 第 10 節）。
// 帳號一定有到期日，最長 60 天；到期當下資料庫就不讓他讀寫賽事，每日排程再把登入停用。

const MAX_DAYS = 60;

async function itemsOfEvent(eventId: string, itemIds: unknown): Promise<string[] | null> {
  if (itemIds === undefined) return [];
  if (!Array.isArray(itemIds) || !itemIds.every(isUuid)) return null;
  if (itemIds.length === 0) return [];
  const { data } = await supabaseAdmin.from('comp_items').select('id').eq('event_id', eventId).in('id', itemIds);
  if ((data ?? []).length !== new Set(itemIds).size) return null; // 有不屬於這場賽事的項目
  return itemIds;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrganizer(req, params.id, { readOnly: true });
  if ('err' in ctx) return ctx.err;
  const { data: rows, error } = await supabaseAdmin
    .from('comp_staff')
    .select('user_id, item_id, staff_role, status')
    .eq('event_id', params.id)
    .eq('source', 'guest');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
  const out = [];
  for (const id of ids) {
    const { data: u } = await supabaseAdmin.from('app_users').select('name, home_org, account_expires_at').eq('id', id).maybeSingle();
    const { data: au } = await supabaseAdmin.auth.admin.getUserById(id);
    out.push({
      id,
      name: u?.name ?? '',
      homeOrg: u?.home_org ?? null,
      email: au?.user?.email ?? null,
      expiresAt: u?.account_expires_at ?? null,
      itemIds: (rows ?? []).filter((r) => r.user_id === id && r.item_id).map((r) => r.item_id),
    });
  }
  return NextResponse.json({ items: out });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrganizer(req, params.id);
  if ('err' in ctx) return ctx.err;
  try {
    const body = (await req.json()) as { name?: string; email?: string; homeOrg?: string; expiresOn?: string; password?: string; itemIds?: unknown };
    const name = (body.name ?? '').trim();
    const email = (body.email ?? '').trim().toLowerCase();
    if (!name || !email || !body.expiresOn) return NextResponse.json({ error: '請填姓名、信箱、到期日' }, { status: 400 });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: '信箱格式不正確' }, { status: 400 });
    const expires = parseExpiry(body.expiresOn);
    if (!expires || expires <= new Date()) return NextResponse.json({ error: '到期日必須是今天之後' }, { status: 400 });
    if (expires.getTime() - Date.now() > MAX_DAYS * 86400000) return NextResponse.json({ error: `賽事訪客帳號最長 ${MAX_DAYS} 天` }, { status: 400 });
    if (body.password !== undefined && body.password.length < 6) return NextResponse.json({ error: '密碼至少要6個字元' }, { status: 400 });
    const itemIds = await itemsOfEvent(params.id, body.itemIds);
    if (itemIds === null) return NextResponse.json({ error: '指定的項目不屬於這場賽事' }, { status: 400 });

    // 1) 取得或建立帳號
    let userId: string | null = await findAuthUserIdByEmail(email);
    let created = false;
    if (userId) {
      const { data: existing } = await supabaseAdmin.from('app_users').select('role').eq('id', userId).maybeSingle();
      if (existing && existing.role !== 'competition_guest') {
        return NextResponse.json(
          { error: 'ALREADY_STAFF：這個信箱已經是本校正式帳號，請該位老師自己在賽事頁面「志願擔任評審」，再由您分派。' },
          { status: 409 }
        );
      }
    } else {
      if (body.password) {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password: body.password, email_confirm: true });
        if (error || !data.user) return NextResponse.json({ error: error?.message ?? '建立帳號失敗' }, { status: 500 });
        userId = data.user.id;
      } else {
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
        if (error || !data.user) return NextResponse.json({ error: error?.message ?? '邀請寄送失敗' }, { status: 500 });
        userId = data.user.id;
      }
      created = true;
    }

    // 2) 角色資料（已存在的訪客則只更新到期日，取較晚者；同時解除停用）
    if (created) {
      const { error: insErr } = await supabaseAdmin.from('app_users').insert({
        id: userId, name, role: 'competition_guest', is_temporary: true,
        home_org: body.homeOrg?.trim() || null, account_expires_at: expires.toISOString(), must_change_password: !!body.password,
      });
      if (insErr) {
        await supabaseAdmin.auth.admin.deleteUser(userId!).catch(() => {});
        return NextResponse.json({ error: '建立角色資料失敗，已復原：' + insErr.message }, { status: 500 });
      }
    } else {
      const { data: cur } = await supabaseAdmin.from('app_users').select('account_expires_at').eq('id', userId).maybeSingle();
      if (!cur?.account_expires_at || new Date(cur.account_expires_at) < expires) {
        await supabaseAdmin.from('app_users').update({ account_expires_at: expires.toISOString() }).eq('id', userId);
      }
      await supabaseAdmin.auth.admin.updateUserById(userId!, { ban_duration: 'none' });
    }

    // 3) 綁定這場賽事（以承辦人身分寫入，受 RLS 與利益衝突觸發器約束）
    const rows = (itemIds.length ? itemIds : [null]).map((item_id) => ({
      event_id: params.id, user_id: userId, staff_role: 'judge', item_id, status: 'assigned', source: 'guest',
    }));
    for (const r of rows) {
      // comp_staff 的唯一索引含 coalesce(item_id)，無法用 upsert，所以先查有沒有重複再新增
      const q = ctx.db.from('comp_staff').select('id').eq('event_id', params.id).eq('user_id', userId!).eq('staff_role', 'judge');
      const { data: dup } = await (r.item_id ? q.eq('item_id', r.item_id) : q.is('item_id', null)).limit(1);
      if (dup && dup.length) continue;
      const { error: e2 } = await ctx.db.from('comp_staff').insert(r);
      if (e2) return NextResponse.json({ error: `帳號已建立，但分派失敗：${e2.message}`, id: userId }, { status: 500 });
    }
    await auditGuest(userId!, ctx.caller.userId, `${created ? '建立' : '加入賽事'} ${name} 到期 ${body.expiresOn}（賽事 ${params.id}）`);
    return NextResponse.json({ success: true, id: userId, created });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? '未知錯誤' }, { status: 500 });
  }
}

// 延長到期日 / 立即停用(expiresOn='now') / 重新指定負責項目(itemIds：整批取代)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrganizer(req, params.id);
  if ('err' in ctx) return ctx.err;
  const body = (await req.json()) as { userId?: string; expiresOn?: string; itemIds?: unknown };
  if (!isUuid(body.userId)) return NextResponse.json({ error: '缺少訪客代碼' }, { status: 400 });
  const { data: link } = await supabaseAdmin.from('comp_staff').select('id').eq('event_id', params.id).eq('user_id', body.userId).eq('source', 'guest').limit(1);
  const { data: u } = await supabaseAdmin.from('app_users').select('role').eq('id', body.userId).maybeSingle();
  if (!link?.length || u?.role !== 'competition_guest') return NextResponse.json({ error: '這位不是本賽事的賽事訪客' }, { status: 404 });

  if (body.itemIds !== undefined) {
    const itemIds = await itemsOfEvent(params.id, body.itemIds);
    if (itemIds === null) return NextResponse.json({ error: '指定的項目不屬於這場賽事' }, { status: 400 });
    const { error: dErr } = await ctx.db.from('comp_staff').delete().eq('event_id', params.id).eq('user_id', body.userId).eq('source', 'guest');
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
    const rows = (itemIds.length ? itemIds : [null]).map((item_id) => ({
      event_id: params.id, user_id: body.userId, staff_role: 'judge', item_id, status: 'assigned', source: 'guest',
    }));
    const { error: iErr } = await ctx.db.from('comp_staff').insert(rows);
    if (iErr) return NextResponse.json({ error: '重新分派失敗：' + iErr.message }, { status: 500 });
  }
  if (body.expiresOn) {
    if (body.expiresOn === 'now') {
      await supabaseAdmin.from('app_users').update({ account_expires_at: new Date().toISOString() }).eq('id', body.userId);
      await supabaseAdmin.auth.admin.updateUserById(body.userId, { ban_duration: '87600h' });
      await auditGuest(body.userId, ctx.caller.userId, '立即停用');
    } else {
      const expires = parseExpiry(body.expiresOn);
      if (!expires || expires <= new Date()) return NextResponse.json({ error: '到期日必須是今天之後' }, { status: 400 });
      if (expires.getTime() - Date.now() > MAX_DAYS * 86400000) return NextResponse.json({ error: `賽事訪客帳號最長 ${MAX_DAYS} 天` }, { status: 400 });
      await supabaseAdmin.from('app_users').update({ account_expires_at: expires.toISOString() }).eq('id', body.userId);
      await supabaseAdmin.auth.admin.updateUserById(body.userId, { ban_duration: 'none' });
      await auditGuest(body.userId, ctx.caller.userId, `延長到期日 ${body.expiresOn}`);
    }
  }
  return NextResponse.json({ success: true });
}

// 從這場賽事移除訪客；如果他不屬於任何其他賽事，帳號一併停用
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrganizer(req, params.id);
  if ('err' in ctx) return ctx.err;
  const userId = req.nextUrl.searchParams.get('userId');
  if (!isUuid(userId)) return NextResponse.json({ error: '缺少訪客代碼' }, { status: 400 });
  const { data: u } = await supabaseAdmin.from('app_users').select('role').eq('id', userId).maybeSingle();
  if (u?.role !== 'competition_guest') return NextResponse.json({ error: '只能移除賽事訪客' }, { status: 400 });
  const { error } = await ctx.db.from('comp_staff').delete().eq('event_id', params.id).eq('user_id', userId).eq('source', 'guest');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { count } = await supabaseAdmin.from('comp_staff').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  let disabled = false;
  if (!count) {
    await supabaseAdmin.from('app_users').update({ account_expires_at: new Date().toISOString() }).eq('id', userId);
    await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '87600h' });
    disabled = true;
  }
  await auditGuest(userId, ctx.caller.userId, `移出賽事 ${params.id}${disabled ? '，帳號已停用' : ''}`);
  return NextResponse.json({ success: true, accountDisabled: disabled });
}

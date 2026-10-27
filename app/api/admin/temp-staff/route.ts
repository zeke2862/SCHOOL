import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getCaller } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

// 臨時（外校支援）教師：建立／查詢／延長或提前停用。
// 誰可以管理：教務處成員、管理員A、系統管理員S／開發人員。臨時教師一律是「任課教師」角色，
// 不能是管理員，也不能被指派部門；到期後權限自動失效（資料庫 current_role_name() 會回傳空），
// 並由每日排程連登入一起停用。

async function authorize(req: NextRequest) {
  const c = await getCaller(req);
  if ('error' in c) return { err: NextResponse.json({ error: c.error }, { status: c.status }) };
  if (!(c.isSD || c.isA || c.hasAcademic)) {
    return { err: NextResponse.json({ error: '只有教務處、管理員A、系統管理員S／開發人員可以管理臨時教師' }, { status: 403 }) };
  }
  return { caller: c };
}

export async function GET(req: NextRequest) {
  const a = await authorize(req);
  if (a.err) return a.err;
  const { data, error } = await supabaseAdmin
    .from('app_users')
    .select('id, name, home_org, account_expires_at, created_at')
    .eq('is_temporary', true)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const out = [];
  for (const u of data ?? []) {
    const { data: au } = await supabaseAdmin.auth.admin.getUserById(u.id);
    out.push({ ...u, email: au?.user?.email ?? null });
  }
  return NextResponse.json({ items: out });
}

export async function POST(req: NextRequest) {
  const a = await authorize(req);
  if (a.err) return a.err;
  try {
    const { email, name, homeOrg, expiresOn, password } = (await req.json()) as {
      email: string;
      name: string;
      homeOrg?: string;
      expiresOn: string; // YYYY-MM-DD（含當天，當天結束時失效）
      password?: string;
    };
    if (!email || !name || !expiresOn) return NextResponse.json({ error: '請填姓名、信箱、到期日' }, { status: 400 });
    const expires = new Date(`${expiresOn}T23:59:59+07:00`);
    if (isNaN(expires.getTime()) || expires <= new Date()) return NextResponse.json({ error: '到期日必須是今天之後' }, { status: 400 });
    if (expires.getTime() - Date.now() > 366 * 86400000) return NextResponse.json({ error: '臨時帳號最長一年，到期可再延長' }, { status: 400 });

    let userId: string;
    if (password) {
      if (password.length < 6) return NextResponse.json({ error: '密碼至少要6個字元' }, { status: 400 });
      const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
      if (cErr || !created.user) {
        if (/already registered|already exists/i.test(cErr?.message ?? '')) return NextResponse.json({ error: 'ALREADY_EXISTS：這個信箱已經有帳號了' }, { status: 409 });
        return NextResponse.json({ error: cErr?.message ?? '建立帳號失敗' }, { status: 500 });
      }
      userId = created.user.id;
    } else {
      const { data: invited, error: iErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
      if (iErr || !invited.user) {
        if (/already registered|already exists/i.test(iErr?.message ?? '')) return NextResponse.json({ error: 'ALREADY_EXISTS：這個信箱已經有帳號了' }, { status: 409 });
        return NextResponse.json({ error: iErr?.message ?? '邀請寄送失敗' }, { status: 500 });
      }
      userId = invited.user.id;
    }

    const { error: insErr } = await supabaseAdmin.from('app_users').insert({
      id: userId,
      name: name.trim(),
      role: 'subject_teacher',
      is_temporary: true,
      home_org: homeOrg?.trim() || null,
      account_expires_at: expires.toISOString(),
      must_change_password: !!password,
    });
    if (insErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      return NextResponse.json({ error: '建立角色資料失敗，已復原：' + insErr.message }, { status: 500 });
    }
    const { error: tErr } = await supabaseAdmin.from('teachers').insert({ name: name.trim(), app_user_id: userId });
    if (tErr) return NextResponse.json({ error: '帳號已建立，但建立教師資料失敗：' + tErr.message }, { status: 500 });

    await supabaseAdmin.from('account_audit_log').insert({
      target_user_id: userId,
      action: '建立臨時教師',
      old_value: null,
      new_value: `${name}（${homeOrg ?? ''}）到期 ${expiresOn}`,
      changed_by: a.caller!.userId,
    });
    return NextResponse.json({ success: true, id: userId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? '未知錯誤' }, { status: 500 });
  }
}

// 延長到期日，或立即停用（expiresOn 傳 'now'）
export async function PATCH(req: NextRequest) {
  const a = await authorize(req);
  if (a.err) return a.err;
  const { id, expiresOn } = (await req.json()) as { id: string; expiresOn: string };
  if (!id || !expiresOn) return NextResponse.json({ error: '缺少欄位' }, { status: 400 });
  const { data: target } = await supabaseAdmin.from('app_users').select('is_temporary').eq('id', id).maybeSingle();
  if (!target?.is_temporary) return NextResponse.json({ error: '只能調整臨時教師帳號' }, { status: 400 });

  if (expiresOn === 'now') {
    await supabaseAdmin.from('app_users').update({ account_expires_at: new Date().toISOString() }).eq('id', id);
    await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: '87600h' });
    await supabaseAdmin.from('proxy_delegations').update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: a.caller!.userId }).or(`agent_user_id.eq.${id},principal_user_id.eq.${id}`).eq('status', 'active');
    await supabaseAdmin.from('account_audit_log').insert({ target_user_id: id, action: '停用臨時教師', old_value: null, new_value: 'now', changed_by: a.caller!.userId });
    return NextResponse.json({ success: true });
  }
  const expires = new Date(`${expiresOn}T23:59:59+07:00`);
  if (isNaN(expires.getTime()) || expires <= new Date()) return NextResponse.json({ error: '到期日必須是今天之後' }, { status: 400 });
  await supabaseAdmin.from('app_users').update({ account_expires_at: expires.toISOString() }).eq('id', id);
  await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: 'none' });
  await supabaseAdmin.from('account_audit_log').insert({ target_user_id: id, action: '延長臨時教師到期日', old_value: null, new_value: expiresOn, changed_by: a.caller!.userId });
  return NextResponse.json({ success: true });
}

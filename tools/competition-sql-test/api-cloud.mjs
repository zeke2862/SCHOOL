// 三支管理 API 的測試：訪客帳號 / 外校名單匯入 / 公開頁連結。
// 對開發伺服器發 HTTP 請求。後端可以是：
//   (a) 本機假 Supabase（tools/competition-sql-test/fake-supabase.mjs）— 預設做法，測 API 邏輯，不含 RLS/觸發器；
//   (b) 測試專案（需要該專案的管理員金鑰，目前取不到）。
// 用法（假後端）：
//   node tools/competition-sql-test/fake-supabase.mjs &
//   用 NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fake-anon SUPABASE_SERVICE_ROLE_KEY=fake-service-key 啟動 next dev -p 3100
//   BASE=http://localhost:3100 SUPA_URL=http://localhost:54321 SUPA_ANON=fake-anon TEST_PW='fake-pw-123' node tools/competition-sql-test/api-cloud.mjs
import ExcelJS from 'exceljs';

const { BASE, SUPA_URL, SUPA_ANON, TEST_PW } = process.env;
if (!BASE || !SUPA_URL || !SUPA_ANON || !TEST_PW) { console.error('缺少 BASE / SUPA_URL / SUPA_ANON / TEST_PW'); process.exit(2); }
if (!/fwqxzfatnowlqpoddydj|localhost:54321/.test(SUPA_URL)) { console.error('只允許對測試專案或本機假後端執行'); process.exit(2); }
const FAKE = /localhost/.test(SUPA_URL); // 假後端沒有 RLS，需要 RLS 才成立的斷言會略過

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ← ' + extra}`); };

async function signIn(email, password = TEST_PW) {
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: SUPA_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  return { ok: r.ok, token: j.access_token, err: j.error_description ?? j.msg ?? j.error };
}
// 以使用者身分呼叫 PostgREST（建立賽事資料用，與頁面相同）
async function rest(token, method, path, body, prefer = 'return=representation') {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { method, headers: { apikey: SUPA_ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, data: t ? JSON.parse(t) : null };
}
async function api(token, method, path, body, raw) {
  const headers = {}; if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof FormData) && !raw) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const ct = r.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer());
  return { status: r.status, data, headers: r.headers };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const tok = {};
for (const [n, e] of Object.entries({ t2: 't2', t3: 't3', guest: 'guest', s1: 's1', admin: 'admin' })) {
  const s = await signIn(`${e}@test.local`);
  if (!s.ok) throw new Error(`登入 ${n} 失敗：${s.err}`);
  tok[n] = s.token;
}
console.log('== 登入成功');

// ---- 準備賽事：承辦人 t2 建立賽事 A（含兩個項目），另一位 t3 建立賽事 B
const mkEvent = async (t, title) => {
  const ev = (await rest(t, 'POST', 'comp_events', { title, scope: 'external', status: 'running' })).data[0];
  const g = (await rest(t, 'POST', 'comp_groups', { event_id: ev.id, code: 'E', name: '小學乙組', grade_levels: ['1年', '2年', '3年'], teacher_only: false, sort_no: 1 })).data[0];
  const items = (await rest(t, 'POST', 'comp_items', [
    { event_id: ev.id, group_id: g.id, code: 'E1', name: '歌唱', score_type: 'judge', criteria: [], config: {}, sort_no: 1 },
    { event_id: ev.id, group_id: g.id, code: 'E2', name: '朗讀', score_type: 'judge', criteria: [], config: {}, sort_no: 2 },
    { event_id: ev.id, group_id: g.id, code: 'V1', name: '布置', score_type: 'vote', criteria: [], config: {}, sort_no: 3 }])).data;
  return { ev, items: Object.fromEntries(items.map((i) => [i.code, i.id])) };
};
const A = await mkEvent(tok.t2, 'API測試賽事A');
const B = await mkEvent(tok.t3, 'API測試賽事B');
ok('建立兩場賽事', !!A.ev?.id && !!B.ev?.id);
const gp = `/api/competitions/${A.ev.id}/guests`;

console.log('\n--- 1. 訪客帳號 API ---');
ok('未登入 → 401', (await api(null, 'GET', gp)).status === 401);
ok('亂填 token → 401', (await api('abc.def.ghi', 'GET', gp)).status === 401);
ok('賽事代碼格式錯 → 400', (await api(tok.t2, 'GET', '/api/competitions/not-a-uuid/guests')).status === 400);
ok('賽事不存在 → 404', (await api(tok.t2, 'GET', '/api/competitions/00000000-0000-0000-0000-000000000000/guests')).status === 404);
ok('非承辦人教師 → 403', (await api(tok.t3, 'GET', gp)).status === 403);
ok('非承辦人不能新增訪客 → 403', (await api(tok.t3, 'POST', gp, { name: 'x', email: 'x@test.local', expiresOn: day(5) })).status === 403);
ok('學生帳號（無教職員資料）→ 403', (await api(tok.s1, 'GET', gp)).status === 403);
ok('賽事訪客不能用承辦人功能 → 403', (await api(tok.guest, 'GET', gp)).status === 403);
ok('管理員 S 可以進入', (await api(tok.admin, 'GET', gp)).status === 200);

const post = (b) => api(tok.t2, 'POST', gp, b);
const base = { name: '陳外聘', email: 'api-guest1@test.local', homeOrg: '清邁外校', expiresOn: day(10), password: 'Guest#2026pw' };
ok('缺姓名 → 400', (await post({ ...base, name: '' })).status === 400);
ok('信箱格式錯 → 400', (await post({ ...base, email: 'not-an-email' })).status === 400);
ok('到期日已過 → 400', (await post({ ...base, expiresOn: day(-1) })).status === 400);
ok('到期日格式錯 → 400', (await post({ ...base, expiresOn: '2026/12/01' })).status === 400);
ok('到期日超過 60 天 → 400', (await post({ ...base, expiresOn: day(61) })).status === 400);
ok('密碼太短 → 400', (await post({ ...base, password: '123' })).status === 400);
ok('項目屬於別的賽事 → 400', (await post({ ...base, itemIds: [B.items.E1] })).status === 400);
ok('項目代碼不是 uuid → 400', (await post({ ...base, itemIds: ['x'] })).status === 400);
// 上面全部失敗的請求都不應該留下帳號
ok('驗證失敗不留下孤兒帳號', !(await signIn('api-guest1@test.local', base.password)).ok);

const c1 = await post({ ...base, itemIds: [A.items.E1] });
ok('建立訪客成功', c1.status === 200 && c1.data?.success && c1.data.created === true, JSON.stringify(c1.data));
const gId = c1.data?.id;
const gl = await signIn('api-guest1@test.local', base.password);
ok('新訪客可用密碼登入', gl.ok, gl.err);
const prof = (await rest(tok.admin, 'GET', `app_users?id=eq.${gId}&select=role,is_temporary,account_expires_at,home_org,must_change_password`)).data?.[0];
ok('帳號資料：角色/臨時/單位/強制改密碼', prof?.role === 'competition_guest' && prof.is_temporary && prof.home_org === '清邁外校' && prof.must_change_password === true, JSON.stringify(prof));
ok('到期日為當天結束（約 10 天後）', prof && Math.abs(new Date(prof.account_expires_at) - new Date(`${day(10)}T23:59:59+07:00`)) < 1000, prof?.account_expires_at);
const st = (await rest(tok.t2, 'GET', `comp_staff?event_id=eq.${A.ev.id}&user_id=eq.${gId}&select=item_id,status,source,staff_role`)).data;
ok('已綁定賽事並分派項目', st?.length === 1 && st[0].item_id === A.items.E1 && st[0].status === 'assigned' && st[0].source === 'guest', JSON.stringify(st));
const aud = (await rest(tok.admin, 'GET', `account_audit_log?target_user_id=eq.${gId}&select=new_value`)).data;
ok('寫入稽核紀錄', aud?.length >= 1 && /賽事訪客/.test(aud[0].new_value), JSON.stringify(aud));
// 訪客本人透過資料庫看自己的賽事
if (!FAKE) {
  const gVis = (await rest(gl.token, 'GET', 'comp_events?select=id')).data;
  ok('訪客看得到被邀請的賽事（只有 A）', gVis?.length === 1 && gVis[0].id === A.ev.id, JSON.stringify(gVis));
  ok('訪客在 app_users 只看到自己', (await rest(gl.token, 'GET', 'app_users?select=id')).data?.length === 1);
}

const c2 = await post({ ...base, itemIds: [A.items.E2] });
ok('同信箱再加入 → 沿用帳號（created=false）', c2.status === 200 && c2.data.created === false && c2.data.id === gId, JSON.stringify(c2.data));
const st2 = (await rest(tok.t2, 'GET', `comp_staff?event_id=eq.${A.ev.id}&user_id=eq.${gId}&select=item_id`)).data;
ok('分派變成兩個項目（E1、E2）', st2?.length === 2, JSON.stringify(st2));
const c2b = await post({ ...base, itemIds: [A.items.E1] });
ok('重複分派同一項目不會重複寫入', (await rest(tok.t2, 'GET', `comp_staff?event_id=eq.${A.ev.id}&user_id=eq.${gId}&select=id`)).data?.length === 2 && c2b.status === 200);
const c3 = await post({ ...base, email: 't3@test.local' });
ok('信箱是正式教師帳號 → 409', c3.status === 409 && /ALREADY_STAFF/.test(c3.data?.error ?? ''), JSON.stringify(c3.data));
ok('正式教師帳號沒有被改成訪客', (await rest(tok.admin, 'GET', 'app_users?id=eq.00000000-0000-0000-0000-0000000000b3&select=role')).data?.[0]?.role === 'subject_teacher');
const c4 = await post({ name: '無項目訪客', email: 'api-guest2@test.local', expiresOn: day(3), password: 'Guest#2026pw' });
ok('不指定項目也能建立（全場邀請）', c4.status === 200 && (await rest(tok.t2, 'GET', `comp_staff?user_id=eq.${c4.data.id}&select=item_id`)).data?.[0]?.item_id === null, JSON.stringify(c4.data));

const list = await api(tok.t2, 'GET', gp);
const me = list.data?.items?.find((x) => x.id === gId);
ok('列表：姓名/信箱/單位/項目', me?.name === '陳外聘' && me.email === 'api-guest1@test.local' && me.homeOrg === '清邁外校' && me.itemIds.length === 2, JSON.stringify(me));

const patch = (b) => api(tok.t2, 'PATCH', gp, b);
ok('PATCH 缺 userId → 400', (await patch({ expiresOn: day(5) })).status === 400);
ok('PATCH 對正式教師 → 404', (await patch({ userId: '00000000-0000-0000-0000-0000000000b3', expiresOn: day(5) })).status === 404);
ok('PATCH 延長：超過 60 天 → 400', (await patch({ userId: gId, expiresOn: day(90) })).status === 400);
ok('PATCH 延長到期日', (await patch({ userId: gId, expiresOn: day(20) })).status === 200
  && Math.abs(new Date((await rest(tok.admin, 'GET', `app_users?id=eq.${gId}&select=account_expires_at`)).data[0].account_expires_at) - new Date(`${day(20)}T23:59:59+07:00`)) < 1000);
ok('PATCH 重新指定項目（整批取代為只有 E2）', (await patch({ userId: gId, itemIds: [A.items.E2] })).status === 200
  && JSON.stringify((await rest(tok.t2, 'GET', `comp_staff?event_id=eq.${A.ev.id}&user_id=eq.${gId}&select=item_id`)).data.map((x) => x.item_id)) === JSON.stringify([A.items.E2]));
ok('PATCH 指定別場賽事項目 → 400', (await patch({ userId: gId, itemIds: [B.items.E1] })).status === 400);
// 賽事 B 的承辦人不能動賽事 A 的訪客
ok('別場承辦人 PATCH A 的訪客 → 403', (await api(tok.t3, 'PATCH', gp, { userId: gId, expiresOn: day(5) })).status === 403);
const stop = await patch({ userId: gId, expiresOn: 'now' });
ok('PATCH 立即停用', stop.status === 200);
const afterStop = await signIn('api-guest1@test.local', base.password);
ok('停用後無法登入', !afterStop.ok, 'still can login');
ok('停用後延長可恢復登入', (await patch({ userId: gId, expiresOn: day(7) })).status === 200 && (await signIn('api-guest1@test.local', base.password)).ok);
const delr = await api(tok.t2, 'DELETE', `${gp}?userId=${gId}`);
ok('DELETE 移出賽事，沒有其他賽事 → 帳號停用', delr.status === 200 && delr.data.accountDisabled === true, JSON.stringify(delr.data));
ok('移除後該賽事沒有他的分派', (await rest(tok.t2, 'GET', `comp_staff?event_id=eq.${A.ev.id}&user_id=eq.${gId}&select=id`)).data?.length === 0);
ok('移除後無法登入', !(await signIn('api-guest1@test.local', base.password)).ok);
ok('DELETE 缺 userId → 400', (await api(tok.t2, 'DELETE', gp)).status === 400);
ok('DELETE 正式教師 → 400', (await api(tok.t2, 'DELETE', `${gp}?userId=00000000-0000-0000-0000-0000000000b3`)).status === 400);
// 同一位訪客加入第二場賽事：移出其中一場不應停用帳號
const g2 = c4.data.id;
await api(tok.t3, 'POST', `/api/competitions/${B.ev.id}/guests`, { name: '無項目訪客', email: 'api-guest2@test.local', expiresOn: day(3) });
const del2 = await api(tok.t2, 'DELETE', `${gp}?userId=${g2}`);
ok('訪客仍屬於別場賽事 → 移除時不停用帳號', del2.status === 200 && del2.data.accountDisabled === false && (await signIn('api-guest2@test.local', 'Guest#2026pw')).ok, JSON.stringify(del2.data));
// 移除後用相同內容重新加入（一般行為測試；實測不快取也通過，但確認重新加入真的有寫入）
const readd = await api(tok.t2, 'POST', gp, { name: '無項目訪客', email: 'api-guest2@test.local', expiresOn: day(3) });
ok('移除後重新加入（相同請求內容）→ 真的有寫入', readd.status === 200 && (await rest(tok.t2, 'GET', `comp_staff?event_id=eq.${A.ev.id}&user_id=eq.${g2}&select=id`)).data?.length === 1, JSON.stringify(readd.data));
const del3 = await api(tok.t2, 'DELETE', `${gp}?userId=${g2}`);
const readd2 = await api(tok.t2, 'POST', gp, { name: '無項目訪客', email: 'api-guest2@test.local', expiresOn: day(3) });
ok('再移除、再加入第二次也有寫入', del3.status === 200 && readd2.status === 200 && (await rest(tok.t2, 'GET', `comp_staff?event_id=eq.${A.ev.id}&user_id=eq.${g2}&select=id`)).data?.length === 1);
// 邀請信路徑（不給密碼）
const inv = await post({ name: '邀請訪客', email: 'api-invite@test.local', expiresOn: day(3) });
console.log(`   （邀請信路徑）status=${inv.status} ${JSON.stringify(inv.data)}`);

console.log('\n--- 2. 外校名單匯入 API ---');
const ip = `/api/competitions/${A.ev.id}/import`;
ok('匯入：未登入 → 401', (await api(null, 'GET', ip)).status === 401);
ok('匯入：非承辦人 → 403', (await api(tok.t3, 'POST', ip, new FormData())).status === 403);
const tpl = await api(tok.t2, 'GET', ip);
ok('下載範本：xlsx 檔頭', tpl.status === 200 && Buffer.isBuffer(tpl.data) && tpl.data.slice(0, 2).toString() === 'PK', `status ${tpl.status}`);
ok('範本下載檔名為 UTF-8 中文', /filename\*=UTF-8''/.test(tpl.headers.get('content-disposition') ?? ''));
const wbT = new ExcelJS.Workbook(); await wbT.xlsx.load(tpl.data);
ok('範本有兩張工作表', wbT.worksheets.map((w) => w.name).join() === '報名資料,項目對照', wbT.worksheets.map((w) => w.name).join());
const ref = []; wbT.getWorksheet('項目對照').eachRow((r, n) => { if (n > 1) ref.push(r.getCell(1).value); });
ok('項目對照只列非投票項目（E1,E2）', ref.join() === 'E1,E2', ref.join());

const mkXlsx = async (rows, sheet = '報名資料') => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(sheet);
  ws.addRow(['項目代碼*', '姓名*', '學校*', '年級', '飲食', '抽籤號']); rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const upload = async (buf, q = '', name = 'list.xlsx', token = tok.t2) => {
  const fd = new FormData(); fd.append('file', new Blob([buf]), name);
  return api(token, 'POST', ip + q, fd);
};
ok('沒附檔案 → 400', (await api(tok.t2, 'POST', ip, new FormData())).status === 400);
ok('不是 .xlsx → 400', (await upload(Buffer.from('a,b'), '', 'x.csv')).status === 400);
ok('壞掉的 xlsx → 500 有錯誤訊息', await (async () => { const r = await upload(Buffer.from('not a zip'), '', 'x.xlsx'); return r.status >= 400 && !!r.data?.error; })());

const good = [['E1', '王小明', '清邁華校', '5年', '葷食', '1'], ['e2', '李小華', '清邁華校', '4年', '素食', ''], ['E1', '陳大同', '美斯樂中學', '', '', '']];
const bad = [['E1', '趙一', '甲校'], ['ZZ', '錢二', '乙校'], ['E1', '', '丙校'], ['V1', '孫三', '丁校'], ['E1', '王小明', '清邁華校']];
const pv = await upload(await mkXlsx([...good, ['（範例）E1', '範例人', '範例校']]));
ok('預覽：3 筆可新增、0 錯誤、範例列被忽略', pv.status === 200 && pv.data.committed === false && pv.data.newRows === 3 && pv.data.errors.length === 0 && pv.data.totalRows === 3, JSON.stringify(pv.data));
ok('預覽不會寫入資料庫', (await rest(tok.t2, 'GET', `comp_registrations?event_id=eq.${A.ev.id}&kind=eq.external&select=id`)).data.length === 0);
const pb = await upload(await mkXlsx([...good, ...bad]));
ok('預覽：偵測錯誤（缺姓名、代碼不存在、投票項目）與檔內重複', pb.status === 200 && pb.data.errors.length === 3 && pb.data.skippedDuplicates === 1, JSON.stringify(pb.data));
ok('錯誤訊息含列號與原因', pb.data.errors.some((e) => /ZZ/.test(e.message)) && pb.data.errors.some((e) => /必填/.test(e.message)) && pb.data.errors.some((e) => /投票/.test(e.message)) && pb.data.errors.every((e) => e.row >= 5), JSON.stringify(pb.data.errors));
const cb = await upload(await mkXlsx([...good, ...bad]), '?commit=1');
ok('有錯誤時 commit → 422 且整批不寫入', cb.status === 422 && cb.data.committed === false && (await rest(tok.t2, 'GET', `comp_registrations?event_id=eq.${A.ev.id}&kind=eq.external&select=id`)).data.length === 0, JSON.stringify(cb.data));
const cg = await upload(await mkXlsx(good), '?commit=1');
ok('無錯誤 commit → 寫入 3 筆', cg.status === 200 && cg.data.committed && cg.data.inserted === 3, JSON.stringify(cg.data));
const regs = (await rest(tok.t2, 'GET', `comp_registrations?event_id=eq.${A.ev.id}&kind=eq.external&select=display_name,school_name,grade_label,diet,draw_number,item_id,status&order=created_at`)).data;
ok('寫入內容正確（欄位、小寫代碼 e2 對應 E2、空白轉 null）', regs.length === 3 && regs[0].display_name === '王小明' && regs[0].grade_label === '5年' && regs[0].diet === '葷食' && regs[0].draw_number === '1'
  && regs[1].item_id === A.items.E2 && regs[2].grade_label === null, JSON.stringify(regs));
const again = await upload(await mkXlsx(good), '?commit=1');
ok('重複上傳同一份 → 全部略過、不重複寫入', again.status === 200 && again.data.inserted === 0 && again.data.skippedDuplicates === 3 && (await rest(tok.t2, 'GET', `comp_registrations?event_id=eq.${A.ev.id}&kind=eq.external&select=id`)).data.length === 3, JSON.stringify(again.data));
ok('別場賽事的承辦人不能匯入到 A → 403', (await upload(await mkXlsx(good), '?commit=1', 'x.xlsx', tok.t3)).status === 403);
const big = Array.from({ length: 2001 }, (_, i) => ['E1', `人${i}`, '某校']);
ok('超過 2000 列 → 400', (await upload(await mkXlsx(big))).status === 400);
const mid = Array.from({ length: 600 }, (_, i) => ['E2', `批次${i}`, '大批校']);
const bm = await upload(await mkXlsx(mid), '?commit=1');
ok('600 列分批寫入（500/批）全部成功', bm.status === 200 && bm.data.inserted === 600 && (await rest(tok.t2, 'GET', `comp_registrations?event_id=eq.${A.ev.id}&school_name=eq.大批校&select=id`, null, 'count=exact')).data.length === 600, JSON.stringify(bm.data).slice(0, 200));
const wrongSheet = await upload(await mkXlsx([['E1', '單頁人', '某校']], 'Sheet1'), '?commit=1');
ok('工作表名稱不是「報名資料」→ 使用第一張工作表', wrongSheet.status === 200 && wrongSheet.data.inserted === 1, JSON.stringify(wrongSheet.data));

console.log('\n--- 3. 公開頁連結 API ---');
const lp = `/api/competitions/${A.ev.id}/public-link`;
ok('連結：未登入 → 401', (await api(null, 'GET', lp)).status === 401);
ok('連結：非承辦人 → 403', (await api(tok.t3, 'GET', lp)).status === 403);
ok('連結：非承辦人不能開啟 → 403', (await api(tok.t3, 'POST', lp, { action: 'enable' })).status === 403);
const l0 = await api(tok.t2, 'GET', lp);
ok('取得代碼（64 位十六進位）與預設關閉', l0.status === 200 && /^[a-f0-9]{64}$/.test(l0.data.token) && l0.data.enabled === false && l0.data.path === `/results/${l0.data.token}` && l0.data.showScore === false, JSON.stringify(l0.data));
const pubUrl = (t) => `/api/public/competition/${t}`;
ok('公開 API：未開啟 → 404', (await api(null, 'GET', pubUrl(l0.data.token))).status === 404);
ok('公開 API：代碼格式不對 → 404', (await api(null, 'GET', pubUrl('abc'))).status === 404);
ok('未知動作 → 400', (await api(tok.t2, 'POST', lp, { action: 'explode' })).status === 400);
ok('show_score 沒給布林 → 400', (await api(tok.t2, 'POST', lp, { action: 'show_score', value: 'yes' })).status === 400);
// 公布一個項目讓公開頁有內容
const regE2 = (await rest(tok.t2, 'GET', `comp_registrations?item_id=eq.${A.items.E2}&display_name=eq.李小華&select=id`)).data[0].id;
const pub1 = await rest(tok.t2, 'POST', 'rpc/comp_publish_item', { p_item: A.items.E2, p_results: [{ registration_id: regE2, total: 88.5, rank: 1, award: '第1名' }] });
ok('（準備）公布 E2 項目', pub1.status === 204 || pub1.status === 200, JSON.stringify(pub1));
const en = await api(tok.t2, 'POST', lp, { action: 'enable' });
ok('開啟公開頁', en.status === 200 && en.data.enabled === true && en.data.token === l0.data.token, JSON.stringify(en.data));
const pv1 = await api(null, 'GET', pubUrl(l0.data.token));
ok('匿名可讀公開頁，只含已公布項目', pv1.status === 200 && pv1.data.items.length === 1 && pv1.data.items[0].item === '朗讀' && pv1.data.items[0].results[0].name === '李小華', JSON.stringify(pv1.data).slice(0, 300));
ok('快取標頭 s-maxage=20', /s-maxage=20/.test(pv1.headers.get('cache-control') ?? ''));
ok('預設不含分數、不含學號', pv1.data.items[0].results[0].total === null && !JSON.stringify(pv1.data).includes('student_no'));
const sc = await api(tok.t2, 'POST', lp, { action: 'show_score', value: true });
ok('開啟顯示分數', sc.status === 200 && sc.data.showScore === true);
ok('公開頁立即顯示分數', (await api(null, 'GET', pubUrl(l0.data.token))).data.items[0].results[0].total === 88.5);
await api(tok.t2, 'POST', lp, { action: 'show_score', value: false });
const dis = await api(tok.t2, 'POST', lp, { action: 'disable' });
ok('關閉公開頁後立刻 404', dis.data.enabled === false && (await api(null, 'GET', pubUrl(l0.data.token))).status === 404);
const rot = await api(tok.t2, 'POST', lp, { action: 'rotate' });
ok('換新代碼：新代碼不同、且預設關閉', rot.status === 200 && rot.data.token !== l0.data.token && /^[a-f0-9]{64}$/.test(rot.data.token) && rot.data.enabled === false, JSON.stringify(rot.data));
await api(tok.t2, 'POST', lp, { action: 'enable' });
ok('舊代碼作廢、新代碼可用', (await api(null, 'GET', pubUrl(l0.data.token))).status === 404 && (await api(null, 'GET', pubUrl(rot.data.token))).status === 200);
ok('管理員 S 也能管理連結', (await api(tok.admin, 'GET', lp)).status === 200);

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);

// 在「真實 Supabase 測試專案」上跑完整流程（真實登入、PostgREST、Storage），呼叫方式與各頁面相同。
// 用法（不要對正式庫跑！）：
//   SUPA_URL=https://xxxx.supabase.co SUPA_ANON=<anon key> TEST_PW=<測試密碼> node tools/competition-sql-test/e2e-cloud.mjs
// 需要先在該專案套用 142、143，並建立測試使用者（見 README）。
import { createClient } from '@supabase/supabase-js';

const { SUPA_URL, SUPA_ANON, TEST_PW } = process.env;
if (!SUPA_URL || !SUPA_ANON || !TEST_PW) { console.error('缺少 SUPA_URL / SUPA_ANON / TEST_PW'); process.exit(2); }
if (!/fwqxzfatnowlqpoddydj/.test(SUPA_URL) && !process.env.I_KNOW_THIS_IS_A_TEST_DB) { console.error('這支腳本會寫入大量測試資料，只允許對測試專案執行'); process.exit(2); }

const mk = () => createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const clients = {};
async function login(name, email) {
  const c = mk();
  const { error } = await c.auth.signInWithPassword({ email, password: TEST_PW });
  if (error) throw new Error(`登入 ${name} 失敗：${error.message}`);
  clients[name] = c;
  return c;
}
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ← ' + extra}`); };
const errOf = (r) => r.error?.message ?? '';

await Promise.all(Object.entries({ admin: 'admin', t1: 't1', t2: 't2', t3: 't3', guest: 'guest', s1: 's1', s2: 's2', parent: 'parent' }).map(([n, e]) => login(n, `${e}@test.local`)));
const anon = mk();
const uid = async (n) => (await clients[n].auth.getUser()).data.user.id;
const [T1, T3, G] = await Promise.all([uid('t1'), uid('t3'), uid('guest')]);
console.log('== 8 個真實帳號登入成功');

// ---- 承辦人建立賽事（與管理頁 /competitions 相同的呼叫）
const t2 = clients.t2;
const ev = await t2.from('comp_events').insert({ title: '雲端測試歌唱比賽', scope: 'external', status: 'draft' }).select('*').single();
ok('教師建立賽事（insert ... select 回傳）', !ev.error && ev.data?.id, errOf(ev));
const E = ev.data.id;
const grp = await t2.from('comp_groups').insert([
  { event_id: E, code: 'E', name: '小學乙組', grade_levels: ['1年', '2年', '3年'], teacher_only: false, sort_no: 1 },
  { event_id: E, code: 'A', name: '教師組', grade_levels: [], teacher_only: true, sort_no: 2 }]).select('id, code');
ok('建立組別', !grp.error && grp.data?.length === 2, errOf(grp));
const gE = grp.data.find((g) => g.code === 'E').id, gA = grp.data.find((g) => g.code === 'A').id;
const itm = await t2.from('comp_items').insert([
  { event_id: E, group_id: gE, code: 'E1', name: '歌唱', score_type: 'judge', criteria: [{ label: '音準', weight: '40%' }, { label: '台風', weight: '60%' }], config: {}, sort_no: 1 },
  { event_id: E, group_id: gA, code: 'A1', name: '歌唱', score_type: 'judge', criteria: [], config: {}, sort_no: 2 },
  { event_id: E, group_id: gE, code: 'V1', name: '教室布置', score_type: 'vote', criteria: [], config: { votes_per_voter: 1 }, sort_no: 3 }]).select('id, code');
ok('建立項目', !itm.error && itm.data?.length === 3, errOf(itm));
const I = Object.fromEntries(itm.data.map((x) => [x.code, x.id]));

// ---- 草稿期間：學生看不到
ok('草稿賽事學生看不到', ((await clients.s1.from('comp_events').select('id').eq('id', E)).data ?? []).length === 0);
await t2.from('comp_events').update({ status: 'open' }).eq('id', E);

// ---- 學生報名（報名頁 /competitions/[id] 的呼叫）
ok('學生取得自己的年級', (await clients.s1.rpc('comp_my_grade')).data === '3年');
const cnt0 = await clients.s2.rpc('comp_item_counts', { p_event: E });
ok('comp_item_counts 可用（學生）', !cnt0.error && cnt0.data?.length === 3, errOf(cnt0));
const r1 = await clients.s1.rpc('comp_register', { p_item: I.E1 });
ok('三年級學生報名小學乙組', !r1.error && r1.data, errOf(r1));
const R1 = r1.data;
ok('六年級學生被擋', /年級/.test(errOf(await clients.s2.rpc('comp_register', { p_item: I.E1 }))));
ok('家長帳號被擋', /學生本人/.test(errOf(await clients.parent.rpc('comp_register', { p_item: I.E1 }))));
ok('重複報名被擋', /已經報名/.test(errOf(await clients.s1.rpc('comp_register', { p_item: I.E1 }))));
ok('學生看不到別人的報名', ((await clients.s2.from('comp_registrations').select('id')).data ?? []).length === 0);
const nt = await clients.t1.from('staff_notifications').select('message').eq('category', '賽事通知');
ok('導師收到報名通知', (nt.data ?? []).length === 1, JSON.stringify(nt));
const tr = await clients.t1.rpc('comp_register', { p_item: I.A1 });
ok('導師報名教師組', !tr.error, errOf(tr));

// ---- 志願 / 指派 / 訪客
ok('教師志願擔任評審', !(await clients.t3.from('comp_staff').insert({ event_id: E, user_id: T3, staff_role: 'judge', status: 'volunteered', source: 'volunteer', prefer_note: '想評歌唱' })).error);
const vol = (await t2.from('comp_staff').select('id').eq('user_id', T3).eq('status', 'volunteered')).data?.[0];
const asg = await t2.from('comp_staff').update({ item_id: I.E1, status: 'assigned', source: 'assigned' }).eq('id', vol.id);
ok('承辦人指派志願者到項目', !asg.error, errOf(asg));
ok('導師被擋（有導生參賽）', /利益衝突/.test(errOf(await t2.from('comp_staff').insert({ event_id: E, user_id: T1, staff_role: 'judge', item_id: I.E1, status: 'assigned', source: 'assigned' }))));
ok('指派外聘訪客', !(await t2.from('comp_staff').insert({ event_id: E, user_id: G, staff_role: 'judge', item_id: I.E1, status: 'assigned', source: 'guest' })).error);
ok('訪客看得到被分派的賽事', ((await clients.guest.from('comp_events').select('id')).data ?? []).length === 1);
await t2.from('comp_events').update({ status: 'running' }).eq('id', E);

// ---- 訪客隔離（對真實 Supabase 的 PostgREST）
const g = clients.guest;
for (const t of ['classes', 'teachers', 'students', 'enrollments', 'staff_notifications', 'portal_accounts']) {
  ok(`訪客讀不到 ${t}`, ((await g.from(t).select('*')).data ?? []).length === 0);
}
ok('訪客在 app_users 只看到自己', ((await g.from('app_users').select('id')).data ?? []).length === 1);
ok('教師看得到 classes', ((await clients.t3.from('classes').select('id')).data ?? []).length === 2);
ok('訪客不能寫 students', !!(await g.from('students').insert({ student_no: 'X', name: 'x' })).error);

// ---- 評審打分頁（草稿 → 更新 → 送出）
const draft = async (c, uidv, total, raw) => c.from('comp_scores').insert({ item_id: I.E1, registration_id: R1, judge_user_id: uidv, raw, total, submitted: false }).select('id').single();
const d1 = await draft(clients.t3, T3, null, { criteria: { 音準: 30 } });
ok('評審存草稿（未打完 total=null）', !d1.error && d1.data?.id, errOf(d1));
ok('草稿未打完不能送出', /沒有打分/.test(errOf(await clients.t3.rpc('comp_submit_my_scores', { p_item: I.E1 }))));
const u1 = await clients.t3.from('comp_scores').update({ raw: { criteria: { 音準: 30, 台風: 50 } }, total: 80 }).eq('id', d1.data.id).select('id').single();
ok('評審更新草稿', !u1.error, errOf(u1));
const dg = await draft(clients.guest, G, 90, { criteria: { 音準: 35, 台風: 55 } });
ok('訪客評審存分數', !dg.error, errOf(dg));
ok('評審不能替別人打分', !!(await draft(clients.t3, G, 1, {})).error);
ok('評審只看到自己的分數', ((await clients.t3.from('comp_scores').select('id')).data ?? []).length === 1);
ok('t3 送出', !(await clients.t3.rpc('comp_submit_my_scores', { p_item: I.E1 })).error);
const upd = await clients.t3.from('comp_scores').update({ total: 99 }).eq('id', d1.data.id).select('id');
ok('送出後不能再改（影響 0 列）', (upd.data ?? []).length === 0, JSON.stringify(upd));
const pubEarly = await t2.rpc('comp_publish_item', { p_item: I.E1, p_results: [{ registration_id: R1, total: 170, rank: 1, award: '第1名' }] });
ok('訪客還沒送出，公布被擋', /外聘陳/.test(errOf(pubEarly)), errOf(pubEarly));
ok('訪客送出', !(await clients.guest.rpc('comp_submit_my_scores', { p_item: I.E1 })).error);

// ---- 公布 / 校內檢視 / QR 公開頁 / 修正
ok('公布前學生看不到成績', ((await clients.s1.from('comp_results').select('*')).data ?? []).length === 0);
ok('承辦人公布', !(await t2.rpc('comp_publish_item', { p_item: I.E1, p_results: [{ registration_id: R1, total: 170, rank: 1, award: '第1名' }] })).error);
const view = await clients.s2.rpc('comp_event_view', { p_event: E });
ok('學生看到已公布成績（comp_event_view）', view.data?.items?.[0]?.results?.[0]?.name === '小明', JSON.stringify(view));
ok('匿名不能呼叫 comp_event_view', !!(await anon.rpc('comp_event_view', { p_event: E })).error);
ok('匿名不能呼叫 comp_view_json', !!(await anon.rpc('comp_view_json', { p_event: E })).error);
ok('匿名不能讀 comp_events', ((await anon.from('comp_events').select('id')).data ?? []).length === 0);
const tok = (await t2.from('comp_events').select('public_token').eq('id', E).single()).data.public_token;
ok('公開頁未開啟 → null', (await anon.rpc('comp_public_view', { p_token: tok })).data === null);
await t2.from('comp_events').update({ public_enabled: true }).eq('id', E);
const pub = await anon.rpc('comp_public_view', { p_token: tok });
ok('匿名用代碼看到公開頁', pub.data?.items?.[0]?.results?.[0]?.rank === 1, JSON.stringify(pub));
ok('公開頁不含學號與分數', !JSON.stringify(pub.data).includes('S001') && pub.data.items[0].results[0].total === null);
ok('修正沒寫說明被擋', !!(await t2.rpc('comp_correct_item', { p_item: I.E1, p_results: [{ registration_id: R1, total: 170, rank: 2, award: '第2名' }], p_reason: '' })).error);
const cor = await t2.rpc('comp_correct_item', { p_item: I.E1, p_results: [{ registration_id: R1, total: 170, rank: 2, award: '第2名' }], p_reason: '第三位評審分數登記錯誤，已更正' });
ok('修正成功（第 1 次）', cor.data === 1, errOf(cor));
const pub2 = await anon.rpc('comp_public_view', { p_token: tok });
ok('公開頁出現修正公告', pub2.data?.notices?.some((n) => n.kind === 'correction') && pub2.data.items[0].revision === 1, JSON.stringify(pub2.data?.notices));
ok('導師收到修正通知', ((await clients.t1.from('staff_notifications').select('id').like('message', '成績修正%')).data ?? []).length === 1);
ok('學生不能公布/修正', !!(await clients.s1.rpc('comp_correct_item', { p_item: I.E1, p_results: [], p_reason: 'xx' })).error);

// ---- 作品投票 + 真實 Storage
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const path = `${E}/${I.V1}/test.png`;
const up = await t2.storage.from('competition').upload(path, png, { contentType: 'image/png' });
ok('承辦人上傳作品照片（Storage）', !up.error, errOf(up));
const vreg = await t2.from('comp_registrations').insert({ event_id: E, item_id: I.V1, kind: 'external', display_name: '作品 1', school_name: '三年甲班', draw_number: '1' }).select('id').single();
const ent = await t2.from('comp_entries').insert({ item_id: I.V1, entry_no: 1, title: null, photo_path: path, registration_id: vreg.data?.id }).select('id').single();
ok('建立作品與參賽者', !vreg.error && !ent.error, errOf(vreg) + errOf(ent));
const sig = await clients.t3.storage.from('competition').createSignedUrls([path], 600);
ok('教師可取得作品簽名網址', !!sig.data?.[0]?.signedUrl, JSON.stringify(sig));
ok('投票頁讀得到作品（教師）', ((await clients.t3.from('comp_entries').select('id')).data ?? []).length === 1);
ok('學生讀不到作品', ((await clients.s1.from('comp_entries').select('id')).data ?? []).length === 0);
ok('訪客讀不到作品照片', !!(await clients.guest.storage.from('competition').createSignedUrls([path], 60)).error || !(await clients.guest.storage.from('competition').createSignedUrls([path], 60)).data?.[0]?.signedUrl);
ok('教師投票', !(await clients.t3.from('comp_votes').insert({ item_id: I.V1, entry_id: ent.data.id })).error);
ok('訪客不能投票', !!(await clients.guest.from('comp_votes').insert({ item_id: I.V1, entry_id: ent.data.id })).error);
ok('非承辦人看不到票數', !!(await clients.t3.rpc('comp_vote_tally', { p_item: I.V1 })).error);
const tally = await t2.rpc('comp_vote_tally', { p_item: I.V1 });
ok('承辦人看得到票數', tally.data?.[0]?.votes === 1, JSON.stringify(tally));
ok('別人看不到我的票', ((await clients.t1.from('comp_votes').select('id')).data ?? []).length === 0);

// ---- 撤回與截止後
ok('比賽中學生不能自行撤回報名', /截止/.test(errOf(await clients.s1.rpc('comp_withdraw', { p_reg: R1 }))));
console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);

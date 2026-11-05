import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', 'sql') + path.sep;
const db = new PGlite();
const rd = (f) => fs.readFileSync(f, 'utf8');

await db.exec(rd(path.join(HERE, 'stubs.sql')));
await db.exec(rd(REPO + '142_competition_guest_role.sql'));
await db.exec(rd(REPO + '143_competitions.sql'));
await db.exec(`grant all on all tables in schema public to authenticated, anon;
grant execute on all functions in schema public to authenticated;`);
console.log('== 142 + 143 載入成功');
// 再跑一次，確認可重複執行
await db.exec(rd(REPO + '142_competition_guest_role.sql'));
await db.exec(rd(REPO + '143_competitions.sql'));
console.log('== 重複執行成功（idempotent）');

const U = {
  admin: '00000000-0000-0000-0000-0000000000a1',
  t1: '00000000-0000-0000-0000-0000000000b1', // 導師（3年班）
  t2: '00000000-0000-0000-0000-0000000000b2', // 承辦人
  t3: '00000000-0000-0000-0000-0000000000b3', // 評審老師
  guest: '00000000-0000-0000-0000-0000000000c1',
  s1: '00000000-0000-0000-0000-0000000000d1',
  s2: '00000000-0000-0000-0000-0000000000d2',
  parent: '00000000-0000-0000-0000-0000000000d3',
};
await db.exec(`
insert into app_users values
 ('${U.admin}','管理員','system_admin_s'),('${U.t1}','王導師','homeroom_teacher'),
 ('${U.t2}','李承辦','subject_teacher'),('${U.t3}','張評審','subject_teacher'),
 ('${U.guest}','外聘陳','competition_guest');
insert into teachers (id, app_user_id, name) values
 ('10000000-0000-0000-0000-000000000001','${U.t1}','王導師'),
 ('10000000-0000-0000-0000-000000000002','${U.t2}','李承辦'),
 ('10000000-0000-0000-0000-000000000003','${U.t3}','張評審');
insert into classes (id, class_name, academic_year, department, grade_level, homeroom_teacher_id) values
 ('20000000-0000-0000-0000-000000000003','三年甲',2026,'國小','3年','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000006','六年甲',2026,'國小','6年','10000000-0000-0000-0000-000000000003');
insert into students values ('S001','小明'),('S002','小華');
insert into enrollments (student_no, class_id, term) values
 ('S001','20000000-0000-0000-0000-000000000003','上學期'),('S002','20000000-0000-0000-0000-000000000006','上學期');
insert into portal_accounts (student_no, auth_user_id, relation) values
 ('S001','${U.s1}','學生本人'),('S002','${U.s2}','學生本人'),('S001','${U.parent}','家長');
`);

let pass = 0, fail = 0;
async function as(user, sql, params) {
  await db.exec(`reset role; set role ${user === 'anon' ? 'anon' : 'authenticated'};`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [user === 'anon' ? '' : JSON.stringify({ sub: U[user] })]);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { err: e.message }; }
  finally { await db.exec('reset role;'); }
}
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ← ' + extra}`); };
const expectOk = async (name, user, sql, params) => { const r = await as(user, sql, params); ok(name, !r.err, r.err); return r; };
const expectErr = async (name, user, sql, params, match) => { const r = await as(user, sql, params); ok(name, !!r.err && (!match || r.err.includes(match)), r.err || '竟然成功了'); return r; };

// ---- 建立賽事（李承辦）
const ev = await expectOk('教師可建立賽事', 't2', `insert into comp_events (title, status, scope) values ('校內歌唱比賽','open','internal') returning id`);
const E = ev.rows[0].id;
const org = await as('admin', `select count(*)::int c from comp_organizers where event_id=$1 and user_id=$2`, [E, U.t2]);
ok('建立者自動成為承辦人', org.rows?.[0]?.c === 1, JSON.stringify(org));
await expectErr('學生入口帳號不能建立賽事', 's1', `insert into comp_events (title) values ('x')`);
await expectErr('賽事訪客不能建立賽事', 'guest', `insert into comp_events (title) values ('x')`);
await expectErr('不能用別人當 created_by', 't3', `insert into comp_events (title, created_by) values ('x', '${U.t2}')`);

const g1 = (await as('t2', `insert into comp_groups (event_id, code, name, grade_levels, sort_no) values ($1,'B','小學乙組','{3年,4年}',1) returning id`, [E])).rows[0].id;
const g2 = (await as('t2', `insert into comp_groups (event_id, code, name, teacher_only, sort_no) values ($1,'T','教師組',true,2) returning id`, [E])).rows[0].id;
const i1 = (await as('t2', `insert into comp_items (event_id, group_id, code, name, score_type, quota) values ($1,$2,'B1','歌唱','judge',5) returning id`, [E, g1])).rows[0].id;
const i2 = (await as('t2', `insert into comp_items (event_id, group_id, code, name, score_type) values ($1,$2,'T1','歌唱','judge') returning id`, [E, g2])).rows[0].id;
await expectErr('非承辦人不能新增組別', 't3', `insert into comp_groups (event_id, code, name) values ($1,'Z','亂加')`, [E]);

// ---- 草稿可見性
await as('t2', `insert into comp_events (title, status) values ('草稿賽事','draft')`);
const vis = await as('s1', `select count(*)::int c from comp_events`);
ok('學生看不到草稿賽事（只看到 1 場）', vis.rows?.[0]?.c === 1, JSON.stringify(vis));
const visG = await as('guest', `select count(*)::int c from comp_events`);
ok('未受邀的訪客看不到任何賽事', visG.rows?.[0]?.c === 0, JSON.stringify(visG));

// ---- 報名
const mg = await as('s1', `select comp_my_grade() g`); ok('學生年級讀取', mg.rows?.[0]?.g === '3年', JSON.stringify(mg));
const reg1 = await expectOk('三年級學生報名小學乙組', 's1', `select comp_register($1) id`, [i1]);
const R1 = reg1.rows?.[0]?.id;
await expectErr('重複報名被擋', 's1', `select comp_register($1)`, [i1], '已經報名');
await db.exec(`insert into hidden_stub values ('S002')`);
await expectErr('休學/轉學等隱藏學生不能報名', 's2', `select comp_register($1)`, [i1], '學籍狀態');
await db.exec(`delete from hidden_stub`);
await expectErr('六年級學生不能報小學乙組', 's2', `select comp_register($1)`, [i1], '年級');
await expectErr('學生不能報教師組', 's1', `select comp_register($1)`, [i2], '教師組');
await expectErr('家長帳號不能報名', 'parent', `select comp_register($1)`, [i1], '學生本人');
await expectErr('賽事訪客不能報名', 'guest', `select comp_register($1)`, [i1]);
await expectErr('學生不能直接 insert 報名表', 's1', `insert into comp_registrations (event_id,item_id,kind,student_no,display_name) values ($1,$2,'student','S001','x')`, [E, i1]);
const notif = await as('admin', `select count(*)::int c from staff_notifications where category='賽事通知' and teacher_id='10000000-0000-0000-0000-000000000001'`);
ok('導師收到報名通知', notif.rows?.[0]?.c === 1, JSON.stringify(notif));
const sSee = await as('s2', `select count(*)::int c from comp_registrations`);
ok('其他學生看不到別人的報名', sSee.rows?.[0]?.c === 0, JSON.stringify(sSee));
const tSee = await as('t1', `select count(*)::int c from comp_registrations`);
ok('導師看得到自己導生的報名', tSee.rows?.[0]?.c === 1, JSON.stringify(tSee));
const t3See = await as('t3', `select count(*)::int c from comp_registrations`);
ok('無關教師看不到報名', t3See.rows?.[0]?.c === 0, JSON.stringify(t3See));
const reg2 = await expectOk('導師報名教師組', 't1', `select comp_register($1) id`, [i2]);
await as('admin', `update comp_events set config='{"max_items_per_person":1}' where id=$1`, [E]);
await expectErr('超過每人最多報名項數', 't1', `select comp_register($1)`, [i1], '教師組');

// ---- 評審分派與利益衝突
await expectErr('志願不能直接寫成已分派', 't3', `insert into comp_staff (event_id,user_id,staff_role,status,source) values ($1,'${U.t3}','judge','assigned','volunteer')`, [E]);
await expectOk('教師可志願當評審', 't3', `insert into comp_staff (event_id,user_id,staff_role,status,source) values ($1,'${U.t3}','judge','volunteered','volunteer')`, [E]);
await expectErr('志願不能替別人登記', 't3', `insert into comp_staff (event_id,user_id,staff_role,status,source) values ($1,'${U.t1}','judge','volunteered','volunteer')`, [E]);
await expectErr('賽事訪客不能自己志願', 'guest', `insert into comp_staff (event_id,user_id,staff_role,status,source) values ($1,'${U.guest}','judge','volunteered','volunteer')`, [E]);
await expectErr('導師不能評自己導生的項目', 't2', `insert into comp_staff (event_id,user_id,staff_role,item_id,status,source) values ($1,'${U.t1}','judge',$2,'assigned','assigned')`, [E, i1], '利益衝突');
await expectErr('參賽者不能評同一項目', 't2', `insert into comp_staff (event_id,user_id,staff_role,item_id,status,source) values ($1,'${U.t1}','judge',$2,'assigned','assigned')`, [E, i2], '利益衝突');
await expectOk('承辦人可設定衝突例外', 't2', `insert into comp_staff (event_id,user_id,staff_role,item_id,status,source,conflict_override) values ($1,'${U.t1}','judge',$2,'assigned','assigned',true)`, [E, i1]);
await expectErr('非承辦人不能設定例外', 't3', `insert into comp_staff (event_id,user_id,staff_role,status,source,conflict_override) values ($1,'${U.t3}','staff','volunteered','volunteer',true)`, [E]);
await as('admin', `delete from comp_staff where user_id='${U.t1}' and item_id=$1`, [i1]);
await as('t2', `update comp_staff set item_id=$2, status='assigned', source='assigned' where event_id=$1 and user_id='${U.t3}'`, [E, i1]);
await expectOk('承辦人指派外聘訪客', 't2', `insert into comp_staff (event_id,user_id,staff_role,item_id,status,source) values ($1,'${U.guest}','judge',$2,'assigned','guest')`, [E, i1]);
const visG2 = await as('guest', `select count(*)::int c from comp_events`);
ok('受邀訪客看得到該賽事', visG2.rows?.[0]?.c === 1, JSON.stringify(visG2));
const gReg = await as('guest', `select count(*)::int c from comp_registrations`);
ok('訪客只看得到被分派項目的名單', gReg.rows?.[0]?.c === 1, JSON.stringify(gReg));

// ---- 評分、送出、公布
const sc = (u, j, tot) => as(u, `insert into comp_scores (item_id, registration_id, judge_user_id, raw, total) values ($1,$2,'${U[j]}','{}',$3)`, [i1, R1, tot]);
ok('評審 t3 打分', !(await sc('t3', 't3', 88)).err);
ok('訪客評審 打分', !(await sc('guest', 'guest', 90)).err);
const x = await as('t3', `insert into comp_scores (item_id, registration_id, judge_user_id, raw, total) values ($1,$2,'${U.guest}','{}',50)`, [i1, R1]);
ok('不能替別的評審打分', !!x.err, '竟然成功');
const seeS = await as('t3', `select count(*)::int c from comp_scores`);
ok('評審只看得到自己的分數', seeS.rows?.[0]?.c === 1, JSON.stringify(seeS));
await expectErr('尚未送出前承辦人公布被擋', 't2', `select comp_publish_item($1,$2::jsonb)`, [i1, JSON.stringify([{ registration_id: R1, total: 89, rank: 1, award: '第1名' }])], '尚未送出');
await expectOk('t3 送出', 't3', `select comp_submit_my_scores($1)`, [i1]);
const upd = await as('t3', `update comp_scores set total=99 where item_id=$1 returning id`, [i1]);
ok('已送出 update 影響 0 列', upd.rows?.length === 0, JSON.stringify(upd));
await expectErr('學生不能公布', 's1', `select comp_publish_item($1,'[]'::jsonb)`, [i1]);
await expectErr('評審 guest 尚未送出，公布被擋', 't2', `select comp_publish_item($1,$2::jsonb)`, [i1, JSON.stringify([{ registration_id: R1, total: 89, rank: 1, award: '第1名' }])], '外聘陳');
await expectOk('guest 送出', 'guest', `select comp_submit_my_scores($1)`, [i1]);
const preRes = await as('s1', `select count(*)::int c from comp_results`);
ok('公布前學生看不到成績', preRes.rows?.[0]?.c === 0, JSON.stringify(preRes));
await expectOk('全部送出後承辦人公布', 't2', `select comp_publish_item($1,$2::jsonb)`, [i1, JSON.stringify([{ registration_id: R1, total: 89, rank: 1, award: '第1名' }])]);
await expectErr('已公布不能重複公布', 't2', `select comp_publish_item($1,'[{"registration_id":"${R1}","total":1}]'::jsonb)`, [i1], '已公布');
const postRes = await as('s1', `select rank from comp_results`);
ok('公布後學生看得到成績', postRes.rows?.[0]?.rank === 1, JSON.stringify(postRes));
const s2Res = await as('s2', `select count(*)::int c from comp_results`);
ok('公布後其他學生也看得到（公開成績）', s2Res.rows?.[0]?.c === 1, JSON.stringify(s2Res));

// ---- 修正公告
const corr = (reason, rank, award) => as('t2', `select comp_correct_item($1,$2::jsonb,$3) r`, [i1, JSON.stringify([{ registration_id: R1, total: 91, rank, award }]), reason]);
ok('修正沒寫說明被擋', !!(await corr('', 1, '第1名')).err);
ok('修正但沒有任何更動被擋', !!(await as('t2', `select comp_correct_item($1,$2::jsonb,'誤植')`, [i1, JSON.stringify([{ registration_id: R1, total: 89, rank: 1, award: '第1名' }])])).err);
const c1 = await corr('第三位評審分數登記錯誤，已更正', 2, '第2名');
ok('修正成功，版次=1', c1.rows?.[0]?.r === 1, JSON.stringify(c1));
const nt = await as('s1', `select kind, revision, title, body from comp_notices order by created_at`);
ok('自動產生公布公告 + 修正公告', nt.rows?.length === 2 && nt.rows[1].kind === 'correction', JSON.stringify(nt));
console.log('   修正公告內容:\n' + (nt.rows?.[1]?.body || '').split('\n').map((l) => '     ' + l).join('\n'));
const n2 = await as('admin', `select count(*)::int c from staff_notifications where message like '成績修正%'`);
ok('修正後通知導師', n2.rows?.[0]?.c === 1, JSON.stringify(n2));
await expectErr('學生不能修正成績', 's1', `select comp_correct_item($1,'[]'::jsonb,'我要改')`, [i1]);

// ---- QR 公開頁
const pub0 = await as('anon', `select comp_public_view((select public_token from comp_events limit 1)) v`);
ok('anon 無法直接讀 comp_events（RLS 擋掉）', (await as('anon', `select count(*)::int c from comp_events`)).rows?.[0]?.c === 0);
const tok = (await as('admin', `select public_token t from comp_events where id=$1`, [E])).rows[0].t;
const p1 = await as('anon', `select comp_public_view($1) v`, [tok]);
ok('未開啟公開 → 回 null', p1.rows?.[0]?.v === null, JSON.stringify(p1));
await as('t2', `update comp_events set public_enabled=true where id=$1`, [E]);
const p2 = await as('anon', `select comp_public_view($1) v`, [tok]);
ok('開啟後匿名可看公開頁', p2.rows?.[0]?.v?.title === '校內歌唱比賽', JSON.stringify(p2));
const v = p2.rows?.[0]?.v;
ok('公開頁只含已公布項目', v?.items?.length === 1 && v.items[0].revision === 1, JSON.stringify(v?.items));
ok('公開頁不洩漏學號/分數', !JSON.stringify(v).includes('S001') && v.items[0].results[0].total === null, JSON.stringify(v?.items?.[0]?.results));
ok('公開頁含修正公告', v?.notices?.some((n) => n.kind === 'correction'), JSON.stringify(v?.notices));
ok('亂猜 token 回 null', (await as('anon', `select comp_public_view('abc') v`)).rows?.[0]?.v === null);
await expectErr('anon 不能呼叫報名', 'anon', `select comp_register($1)`, [i1]);

// ---- 校內賽事頁用的函式
const cts = await as('s2', `select item_id, registered::int n from comp_item_counts($1)`, [E]);
ok('學生可取得各項目報名人數（額滿判斷用）', cts.rows?.find((x) => x.item_id === i1)?.n === 1, JSON.stringify(cts));
const evv = await as('s2', `select comp_event_view($1) v`, [E]);
ok('學生可看到已公布成績（含姓名）', evv.rows?.[0]?.v?.items?.[0]?.results?.[0]?.name === '小明', JSON.stringify(evv));
ok('學生看不到學號', !JSON.stringify(evv.rows?.[0]?.v).includes('S001'));
const draftEv = (await as('admin', `select id from comp_events where status='draft' limit 1`)).rows?.[0]?.id;
ok('學生取不到草稿賽事的檢視', (await as('s2', `select comp_event_view($1) v`, [draftEv])).rows?.[0]?.v === null);
ok('匿名不能呼叫 comp_event_view', !!(await as('anon', `select comp_event_view($1)`, [E])).err);
ok('內部函式 comp_view_json 不開放直接呼叫', !!(await as('s1', `select comp_view_json($1)`, [E])).err && !!(await as('anon', `select comp_view_json($1)`, [E])).err);

// ---- 作品投票
const vi = (await as('t2', `insert into comp_items (event_id, group_id, code, name, score_type, config) values ($1,$2,'V1','教室布置','vote','{"votes_per_voter":1}') returning id`, [E, g1])).rows[0].id;
const en1 = (await as('t2', `insert into comp_entries (item_id, entry_no, photo_path) values ($1,1,'a.jpg') returning id`, [vi])).rows[0].id;
const en2 = (await as('t2', `insert into comp_entries (item_id, entry_no, photo_path) values ($1,2,'b.jpg') returning id`, [vi])).rows[0].id;
const stuEntries = await as('s1', `select count(*)::int c from comp_entries`);
ok('學生看不到投票作品', stuEntries.rows?.[0]?.c === 0, JSON.stringify(stuEntries));
await expectOk('教師投票', 't3', `insert into comp_votes (item_id, entry_id) values ($1,$2)`, [vi, en1]);
await expectErr('超過每人票數', 't3', `insert into comp_votes (item_id, entry_id) values ($1,$2)`, [vi, en2], '票數上限');
await expectErr('訪客不能投票', 'guest', `insert into comp_votes (item_id, entry_id) values ($1,$2)`, [vi, en1]);
await expectErr('不能替別人投票', 't1', `insert into comp_votes (item_id, entry_id, voter_user_id) values ($1,$2,'${U.t3}')`, [vi, en1]);
await expectErr('非承辦人看不到票數', 't3', `select * from comp_vote_tally($1)`, [vi], '承辦人');
const tally = await as('t2', `select entry_no, votes::int v from comp_vote_tally($1)`, [vi]);
ok('承辦人看得到票數', tally.rows?.[0]?.entry_no === 1 && tally.rows[0].v === 1, JSON.stringify(tally));
const myVotes = await as('t1', `select count(*)::int c from comp_votes`);
ok('別人看不到我的票', myVotes.rows?.[0]?.c === 0, JSON.stringify(myVotes));
await as('admin', `update comp_items set config='{"votes_per_voter":3,"vote_close_at":"2000-01-01T00:00:00Z"}' where id=$1`, [vi]);
await expectErr('投票截止後被擋', 't1', `insert into comp_votes (item_id, entry_id) values ($1,$2)`, [vi, en2], '投票時間');
const del = await as('t3', `delete from comp_votes where item_id=$1 returning id`, [vi]);
ok('截止後不能收回自己的票', del.rows?.length === 0, JSON.stringify(del));
const tally2 = await as('t2', `select entry_no, votes::int v from comp_vote_tally($1)`, [vi]);
ok('截止後票數不變', tally2.rows?.[0]?.v === 1, JSON.stringify(tally2));
await as('admin', `update comp_items set config='{"votes_per_voter":3}' where id=$1`, [vi]);
const del2 = await as('t3', `delete from comp_votes where item_id=$1 returning id`, [vi]);
ok('投票期間內可以收回自己的票', del2.rows?.length === 1, JSON.stringify(del2));


// ---- 訪客隔離（寬鬆政策 using(true) 的表）
const cnt = async (u, t) => (await as(u, `select count(*)::int c from ${t}`)).rows?.[0]?.c;
ok('學生仍可讀 classes（行為不變）', (await cnt('s1', 'classes')) === 2);
ok('訪客讀不到 classes', (await cnt('guest', 'classes')) === 0);
ok('訪客讀不到教師名單', (await cnt('guest', 'teachers')) === 0);
ok('訪客讀不到學生資料', (await cnt('guest', 'students')) === 0);
ok('訪客讀不到導師通知', (await cnt('guest', 'staff_notifications')) === 0);
ok('訪客在 app_users 只看到自己', (await cnt('guest', 'app_users')) === 1);
ok('教師在 app_users 仍看得到全部', (await cnt('t3', 'app_users')) === 5);
ok('訪客不能寫入 students', !!(await as('guest', `insert into students values ('X','x')`)).err);
ok('訪客仍可讀自己被分派的賽事資料', (await cnt('guest', 'comp_items')) >= 1);

// ---- 訪客到期
await db.exec(`update app_users set account_expires_at = now() - interval '1 minute' where id='${U.guest}'`);
{ const q = await as('guest', 'select count(*)::int c from comp_events'); ok('到期訪客看不到賽事', q.rows?.[0]?.c === 0, JSON.stringify(q)); }
ok('到期訪客不能打分', !!(await as('guest', `insert into comp_scores (item_id, registration_id, judge_user_id, raw, total) values ($1,$2,'${U.guest}','{}',1)`, [i1, R1])).err);
await db.exec(`update app_users set account_expires_at = null where id='${U.guest}'`);

// ---- 撤回
await expectOk('學生報名中可撤回', 's1', `select comp_withdraw($1)`, [R1]);

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);

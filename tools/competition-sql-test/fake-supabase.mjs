// 本機「假 Supabase」：用記憶體模擬 Auth（含 admin API）和 PostgREST 的常用功能，
// 只用來測 app/api 底下三支管理 API 的邏輯（驗證、權限、錯誤處理、Excel、流程順序）。
// 它「不是」真實平台：不做 RLS、不跑資料庫觸發器，這兩項已由 PGlite 與真實測試庫另外測過。
// 啟動：node tools/competition-sql-test/fake-supabase.mjs   （預設埠 54321，管理員金鑰 fake-service-key）
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.FAKE_PORT ?? 54321);
const SERVICE = 'fake-service-key';
const uuid = () => crypto.randomUUID();
const rand64 = () => crypto.randomBytes(32).toString('hex');

const users = new Map(); // id -> {id,email,password,banned}
const tokens = new Map(); // token -> userId
const T = { app_users: [], app_user_departments: [], account_audit_log: [], comp_events: [], comp_organizers: [], comp_groups: [], comp_items: [], comp_staff: [], comp_registrations: [], comp_results: [], comp_notices: [] };
const ids = { admin: '00000000-0000-0000-0000-0000000000a1', t2: '00000000-0000-0000-0000-0000000000b2', t3: '00000000-0000-0000-0000-0000000000b3', guest: '00000000-0000-0000-0000-0000000000c1', s1: '00000000-0000-0000-0000-0000000000d1' };
const seed = (key, role, name) => {
  users.set(ids[key], { id: ids[key], email: `${key}@test.local`, password: 'fake-pw-123', banned: false });
  if (role) T.app_users.push({ id: ids[key], name, role, is_temporary: role === 'competition_guest', account_expires_at: null, home_org: null, must_change_password: false });
};
seed('admin', 'system_admin_s', '管理員'); seed('t2', 'subject_teacher', '李承辦'); seed('t3', 'subject_teacher', '張評審');
seed('guest', 'competition_guest', '外聘陳'); seed('s1', null, '學生');

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'content-range' };
const userOut = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer /i, '');
const userIdOf = (req) => tokens.get(bearer(req)) ?? null;

const DEFAULTS = {
  comp_events: (r, uid) => ({ id: uuid(), description: null, scope: 'internal', status: 'draft', public_enabled: false, public_token: rand64(), config: {}, created_by: uid, created_at: new Date().toISOString(), ...r }),
  comp_groups: (r) => ({ id: uuid(), grade_levels: [], teacher_only: false, sort_no: 0, ...r }),
  comp_items: (r) => ({ id: uuid(), score_type: 'judge', judge_count: 3, criteria: [], quota: null, config: {}, revision: 0, published_at: null, sort_no: 0, ...r }),
  comp_staff: (r) => ({ id: uuid(), staff_role: 'judge', item_id: null, status: 'volunteered', source: 'volunteer', conflict_override: false, created_at: new Date().toISOString(), ...r }),
  comp_registrations: (r, uid) => ({ id: uuid(), kind: 'external', student_no: null, teacher_user_id: null, school_name: null, grade_label: null, diet: null, draw_number: null, status: 'registered', registered_by: uid, created_at: new Date().toISOString(), ...r }),
  app_users: (r) => ({ is_temporary: false, account_expires_at: null, home_org: null, must_change_password: false, ...r }),
  account_audit_log: (r) => ({ id: uuid(), created_at: new Date().toISOString(), ...r }),
  comp_organizers: (r) => ({ added_at: new Date().toISOString(), ...r }),
};

function matchFilter(row, key, spec) {
  const [op, ...rest] = spec.split('.'); const val = rest.join('.');
  const v = row[key];
  if (op === 'eq') return String(v) === val;
  if (op === 'neq') return String(v) !== val;
  if (op === 'is') return val === 'null' ? v === null || v === undefined : String(v) === val;
  if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(v));
  if (op === 'like') return new RegExp('^' + val.replace(/%/g, '.*') + '$').test(String(v));
  return true;
}
function project(rows, select) {
  if (!select || select === '*') return rows;
  const emb = [...select.matchAll(/(\w+)\(([^)]*)\)/g)];
  const base = select.replace(/\w+\([^)]*\)/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  return rows.map((r) => {
    const o = {};
    base.forEach((c) => { if (c === '*') Object.assign(o, r); else o[c] = r[c]; });
    emb.forEach(([, tbl, cols]) => {
      const fk = tbl === 'comp_groups' ? r.group_id : null;
      const hit = T[tbl]?.find((x) => x.id === fk);
      o[tbl] = hit ? Object.fromEntries(cols.split(',').map((c) => [c.trim(), hit[c.trim()]])) : null;
    });
    return o;
  });
}

function publicView(ev) {
  const items = T.comp_items.filter((i) => i.event_id === ev.id && i.published_at).map((i) => ({
    group: T.comp_groups.find((g) => g.id === i.group_id)?.name, item: i.name, revision: i.revision, published_at: i.published_at,
    results: T.comp_results.filter((r) => r.item_id === i.id).map((r) => {
      const reg = T.comp_registrations.find((x) => x.id === r.registration_id);
      return { name: reg?.display_name, school: reg?.school_name, rank: r.rank, award: r.award, total: ev.config?.public_show_score ? r.total : null };
    }),
  }));
  return { title: ev.title, items, notices: [] };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  const body = raw && (req.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : null;
  const send = (o, code = 200, extra = {}) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json', ...extra }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const isService = bearer(req) === SERVICE;
  const p = u.pathname;

  // ---------- Auth ----------
  if (p === '/auth/v1/token') {
    const user = [...users.values()].find((x) => x.email === body?.email);
    if (!user || user.password !== body?.password) return send({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
    if (user.banned) return send({ error: 'user_banned', error_description: 'User is banned' }, 400);
    const t = `tok.${user.id}.${crypto.randomBytes(4).toString('hex')}`; tokens.set(t, user.id);
    return send({ access_token: t, token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user: userOut(user) });
  }
  if (p === '/auth/v1/user' && req.method === 'GET') {
    const id = userIdOf(req); const user = id && users.get(id);
    if (!user) return send({ code: 401, msg: 'invalid JWT' }, 401);
    if (user.banned) return send({ code: 403, msg: 'User banned' }, 403);
    return send(userOut(user));
  }
  if (p.startsWith('/auth/v1/admin/users') || p === '/auth/v1/invite') {
    if (!isService) return send({ msg: 'not admin' }, 403);
    const m = p.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (p === '/auth/v1/admin/users' && req.method === 'GET') return send({ users: [...users.values()].map(userOut), aud: 'authenticated' });
    if (p === '/auth/v1/admin/users' && req.method === 'POST') {
      if ([...users.values()].some((x) => x.email === body.email)) return send({ code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' }, 422);
      const user = { id: uuid(), email: body.email, password: body.password, banned: false }; users.set(user.id, user); return send(userOut(user));
    }
    if (p === '/auth/v1/invite' && req.method === 'POST') {
      if ([...users.values()].some((x) => x.email === body.email)) return send({ code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' }, 422);
      const user = { id: uuid(), email: body.email, password: crypto.randomUUID(), banned: false }; users.set(user.id, user); return send(userOut(user));
    }
    if (m) {
      const user = users.get(m[1]); if (!user) return send({ msg: 'User not found' }, 404);
      if (req.method === 'GET') return send(userOut(user));
      if (req.method === 'PUT') { if (body.ban_duration) user.banned = body.ban_duration !== 'none'; return send(userOut(user)); }
      if (req.method === 'DELETE') { users.delete(m[1]); return send({}); }
    }
    return send({ msg: 'unsupported' }, 400);
  }
  if (p === '/__reset') { for (const k of Object.keys(T)) if (!['app_users'].includes(k)) T[k].length = 0; return send({ ok: true }); }
  if (p === '/__dump') return send({ users: [...users.values()].map(({ password, ...x }) => x), tables: T });

  // ---------- RPC ----------
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.split('/').pop();
    if (fn === 'comp_public_view') {
      const ev = T.comp_events.find((e) => e.public_token === body.p_token && e.public_enabled);
      return send(ev ? publicView(ev) : null);
    }
    if (fn === 'comp_publish_item') {
      const it = T.comp_items.find((i) => i.id === body.p_item);
      if (!it) return send({ message: '找不到項目' }, 400);
      if (!body.p_results?.length) return send({ message: '沒有可公布的成績' }, 400);
      body.p_results.forEach((r) => T.comp_results.push({ item_id: it.id, registration_id: r.registration_id, total: r.total, rank: r.rank, award: r.award }));
      it.published_at = new Date().toISOString(); return send(null, 200);
    }
    return send({ message: 'unsupported rpc' }, 404);
  }

  // ---------- PostgREST ----------
  const m = p.match(/^\/rest\/v1\/(\w+)$/);
  if (!m || !T[m[1]]) return send({ message: 'unknown table' }, 404);
  const table = m[1]; const rows = T[table];
  const uid = isService ? null : userIdOf(req);
  if (!isService && !uid) return send({ message: 'JWT invalid' }, 401);
  const filters = [...u.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k));
  const sel = (r) => filters.every(([k, v]) => matchFilter(r, k, v));
  const wantRep = /return=representation/.test(req.headers.prefer ?? '');
  const single = (req.headers.accept ?? '').includes('vnd.pgrst.object');
  const out = (list, code = 200) => {
    if (single) { if (list.length !== 1) return send({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406); return send(list[0], code); }
    return send(list, code);
  };

  if (req.method === 'GET' || req.method === 'HEAD') {
    let list = rows.filter(sel);
    const ord = u.searchParams.get('order');
    if (ord) { const [c, d] = ord.split('.'); list = [...list].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (d === 'desc' ? -1 : 1)); }
    const lim = u.searchParams.get('limit'); if (lim) list = list.slice(0, Number(lim));
    const hdr = { 'content-range': `0-${Math.max(0, list.length - 1)}/${list.length}` };
    if (req.method === 'HEAD') { res.writeHead(200, { ...cors, ...hdr }); return res.end(); }
    return single ? out(project(list, u.searchParams.get('select'))) : send(project(list, u.searchParams.get('select')), 200, hdr);
  }
  if (req.method === 'POST') {
    const arr = Array.isArray(body) ? body : [body];
    const made = arr.map((r) => (DEFAULTS[table] ? DEFAULTS[table](r, uid) : { ...r }));
    rows.push(...made);
    if (table === 'comp_events') made.forEach((e) => T.comp_organizers.push({ event_id: e.id, user_id: e.created_by, added_at: new Date().toISOString() })); // 模擬建立者自動成為承辦人的觸發器
    return wantRep ? out(project(made, u.searchParams.get('select')), 201) : send(undefined, 201);
  }
  if (req.method === 'PATCH') {
    const hit = rows.filter(sel); hit.forEach((r) => Object.assign(r, body));
    return wantRep ? out(project(hit, u.searchParams.get('select'))) : send(undefined, 204);
  }
  if (req.method === 'DELETE') {
    const hit = rows.filter(sel); hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
    return wantRep ? out(hit) : send(undefined, 204);
  }
  send({ message: 'unsupported' }, 405);
});
server.listen(PORT, () => console.log(`fake supabase on ${PORT}`));

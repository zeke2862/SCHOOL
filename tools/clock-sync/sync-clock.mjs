#!/usr/bin/env node
// ============================================================
// 打卡機 CSV → 校務系統：本機自動同步程式（不需要安裝任何套件，Node.js 18 以上即可）
//
// 做的事：
//   1) 取得打卡資料：config.json 有 device.ip 就直接連打卡機讀（zk.mjs，需要通訊密碼 device.commKey）；
//      否則讀打卡機軟體匯出的 CSV（csvPath，可以是檔案，也可以是資料夾——資料夾就取最新的 .csv）
//   2) 問網站「資料庫目前最新一筆打卡是什麼時候」，只送那之前 lookbackDays 天以後的資料（不用每天重送整份）
//   3) 分批送到 /api/clock/import（伺服器會自動略過重複的打卡，所以重複執行、重疊送都很安全）
//   4) 結果寫進 sync.log；失敗會以非 0 結束碼離開（排程工作的「上次執行結果」會顯示錯誤）
//
// 用法：node sync-clock.mjs [--force] [--dry-run] [--config=路徑]
//   --force    檔案沒變動也照樣送（預設：檔案大小與修改時間都沒變就略過）
//   --dry-run  只檢查檔案與連線、顯示會送多少筆，不真的送出
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
const cfgArg = args.find((a) => a.startsWith('--config='));
const CONFIG_PATH = cfgArg ? cfgArg.slice('--config='.length) : path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, '.sync-state.json');
const LOG_PATH = path.join(__dirname, 'sync.log');

function stamp() {
  const d = new Date(Date.now() + 7 * 3600 * 1000); // 以泰國時間記錄
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
function log(msg) {
  const line = `[${stamp()}] ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 1024 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch {
    /* 寫不了 log 不影響同步 */
  }
}
function fail(msg) {
  log('❌ ' + msg);
  process.exit(1);
}

if (Number(process.versions.node.split('.')[0]) < 18) fail(`Node.js 版本太舊（${process.versions.node}），請安裝 Node.js 18 以上`);

// ---------- 設定 ----------
if (!fs.existsSync(CONFIG_PATH)) fail(`找不到設定檔 ${CONFIG_PATH}。請複製 config.example.json 成 config.json 並填寫。`);
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  fail('config.json 不是正確的 JSON：' + e.message);
}
const apiBase = String(cfg.apiBase ?? '').replace(/\/+$/, '');
const token = String(cfg.token ?? '');
const csvPath = String(cfg.csvPath ?? '');
const lookbackDays = Number.isFinite(Number(cfg.lookbackDays)) ? Number(cfg.lookbackDays) : 3;
const batchLines = Math.max(200, Number(cfg.batchLines) || 3000);
if (!/^https?:\/\//.test(apiBase)) fail('config.json 的 apiBase 要是完整網址，例如 https://your-school.vercel.app');
if (!token || token.includes('請填')) fail('config.json 的 token 還沒填（要跟 Vercel 環境變數 CLOCK_SYNC_TOKEN 一模一樣）');
// device.ip 有填：直接連打卡機讀；沒填：讀打卡機軟體匯出的 CSV
const device = cfg.device && String(cfg.device.ip ?? '').trim() && !String(cfg.device.ip).includes('請填') ? cfg.device : null;
if (!device && (!csvPath || csvPath.includes('請填'))) fail('config.json 的 csvPath 還沒填（或改填 device 直接連打卡機）');

let csvFile = null;
let st = null;
let lines;
if (device) lines = await loadFromDevice(device);
else lines = loadFromCsv();
const header = lines[0];
const sourceLabel = device ? `device-${device.ip}` : path.basename(csvFile);

// ---------- 直接連打卡機 ----------
async function loadFromDevice(dev) {
  const { ZkClient, verifyLabel } = await import('./zk.mjs');
  const machineNo = Number(dev.machineNo) || 1;
  const zk = new ZkClient({ ip: String(dev.ip).trim(), port: Number(dev.port) || 4370, timeoutMs: (Number(dev.timeoutSec) || 20) * 1000 });
  let users, logs;
  try {
    await zk.connect(dev.commKey ?? 0);
    const sizes = await zk.readSizes();
    users = await zk.getUsers(sizes.users);
    logs = await zk.getAttendance(sizes.records);
    log(`打卡機 ${dev.ip}：人員 ${users.length} 位、打卡紀錄 ${logs.length} 筆`);
  } catch (e) {
    fail(e.message);
  } finally {
    await zk.disconnect();
  }
  const names = new Map(users.map((u) => [u.userId, u.name]));
  const pad = (n) => String(n).padStart(2, '0');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  // 組成跟軟體匯出一樣的 9 欄格式，伺服器端照原本方式解析
  const out = ['Depart,Name,No,DateTime,Status,MachineNo,EmpNo,VerifyMode,Card'];
  for (const r of logs) {
    if (!/^\d+$/.test(r.userId)) continue;
    const t = r.time;
    const dt = `${pad(t.day)}/${pad(t.month)}/${t.year} ${pad(t.hour)}:${pad(t.minute)}`;
    const dir = r.punch === 1 ? 'C/Out' : 'C/In';
    out.push(['', q(names.get(r.userId) ?? ''), r.userId, dt, dir, machineNo, '', verifyLabel(r.status), ''].join(','));
  }
  if (out.length < 2) fail('打卡機裡沒有打卡紀錄');
  return out;
}

// ---------- 找 CSV ----------
function resolveCsv(p) {
  if (!fs.existsSync(p)) fail(`找不到 csvPath：${p}`);
  const st = fs.statSync(p);
  if (!st.isDirectory()) return p;
  const files = fs
    .readdirSync(p)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .map((f) => ({ f: path.join(p, f), t: fs.statSync(path.join(p, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (files.length === 0) fail(`資料夾裡沒有 .csv 檔：${p}`);
  return files[0].f;
}
function loadFromCsv() {
  csvFile = resolveCsv(csvPath);
  st = fs.statSync(csvFile);

  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    /* 第一次執行 */
  }
  if (!FORCE && !DRY && prev.file === csvFile && prev.size === st.size && prev.mtimeMs === st.mtimeMs) {
    log(`略過：${path.basename(csvFile)} 自上次成功同步後沒有變動（要強制重送請加 --force）`);
    process.exit(0);
  }

  // 解碼（UTF-8 失敗就當泰文 Windows-874；表頭以外都是 ASCII，所以最差的 latin1 也不影響資料）
  const bytes = fs.readFileSync(csvFile);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    try {
      text = new TextDecoder('windows-874').decode(bytes);
    } catch {
      text = new TextDecoder('latin1').decode(bytes);
    }
  }
  const out = text.split(/\r?\n/).filter((l) => l.trim());
  if (out.length < 2) fail(`${csvFile} 沒有資料列`);
  return out;
}

const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d{1,2}:\d{2}/;
function lineDateNum(line) {
  const m = DATE_RE.exec(line);
  if (!m) return null;
  let y = Number(m[3]);
  if (y > 2400) y -= 543;
  return y * 10000 + Number(m[2]) * 100 + Number(m[1]);
}

// ---------- API ----------
async function api(method, url, body) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'text/csv; charset=utf-8' } : {}) },
        body,
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(`HTTP ${res.status}：${json.error ?? '(無訊息)'}`), { fatal: true });
      lastErr = new Error(`HTTP ${res.status}：${json.error ?? ''}`);
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  throw lastErr;
}

try {
  const status = await api('GET', `${apiBase}/api/clock/import`);
  let cutoff = 0;
  if (status.lastPunchAt) {
    const bkk = new Date(new Date(status.lastPunchAt).getTime() + 7 * 3600 * 1000 - lookbackDays * 86400000);
    cutoff = bkk.getUTCFullYear() * 10000 + (bkk.getUTCMonth() + 1) * 100 + bkk.getUTCDate();
    log(`網站目前最新一筆打卡：${status.lastPunchAt}，這次送 ${bkk.toISOString().slice(0, 10)} 之後的資料`);
  } else {
    log('網站目前還沒有任何打卡資料，這次會送整份檔案');
  }

  const dataLines = lines.slice(1).filter((l) => {
    const n = lineDateNum(l);
    return n != null && n >= cutoff;
  });
  log(`來源：${sourceLabel}（共 ${lines.length - 1} 列），本次要送 ${dataLines.length} 列`);

  if (DRY) {
    log('（--dry-run：不送出）');
    process.exit(0);
  }

  const tot = { received: 0, inserted: 0, duplicates: 0, invalid: 0, newCodes: new Set() };
  for (let i = 0; i < dataLines.length; i += batchLines) {
    const body = [header, ...dataLines.slice(i, i + batchLines)].join('\n');
    const r = await api('POST', `${apiBase}/api/clock/import?file=${encodeURIComponent(sourceLabel)}`, body);
    tot.received += r.received ?? 0;
    tot.inserted += r.inserted ?? 0;
    tot.duplicates += r.duplicates ?? 0;
    tot.invalid += r.invalid ?? 0;
    for (const c of r.newCodes ?? []) tot.newCodes.add(c);
  }

  if (csvFile) fs.writeFileSync(STATE_PATH, JSON.stringify({ file: csvFile, size: st.size, mtimeMs: st.mtimeMs, lastOkAt: stamp() }));
  log(`✅ 完成：送出 ${tot.received} 筆，新增 ${tot.inserted}、重複略過 ${tot.duplicates}、格式不符 ${tot.invalid}` + (tot.newCodes.size ? `；新機號 ${[...tot.newCodes].join('、')}（請到網站「人員對照」設定）` : ''));
} catch (e) {
  fail('同步失敗：' + (e?.message ?? e));
}

// ============================================================
// ZKTeco 打卡機 TCP 通訊（port 4370），只用 Node.js 內建模組。
// 協定與 pyzk（github.com/fananimi/pyzk）相同：連線 → 需要時用通訊密碼驗證 →
// 以緩衝區方式讀取人員與打卡紀錄 → 結束連線。只讀取，不會改機器上的任何設定或資料。
// ============================================================
import net from 'node:net';

const CMD_CONNECT = 1000;
const CMD_EXIT = 1001;
const CMD_AUTH = 1102;
const CMD_ACK_OK = 2000;
const CMD_ACK_UNAUTH = 2005;
const CMD_PREPARE_DATA = 1500;
const CMD_DATA = 1501;
const CMD_FREE_DATA = 1502;
const CMD_PREPARE_BUFFER = 1503;
const CMD_READ_BUFFER = 1504;
const CMD_GET_FREE_SIZES = 50;
const CMD_ATTLOG_RRQ = 13;
const CMD_USERTEMP_RRQ = 9;
const FCT_USER = 5;
const USHRT_MAX = 65535;
const MAX_CHUNK = 0xffc0;

function checksum(buf) {
  let sum = 0;
  let i = 0;
  for (; i + 1 < buf.length; i += 2) {
    sum += buf[i] | (buf[i + 1] << 8);
    if (sum > USHRT_MAX) sum -= USHRT_MAX;
  }
  if (i < buf.length) sum += buf[buf.length - 1];
  while (sum > USHRT_MAX) sum -= USHRT_MAX;
  sum = ~sum;
  while (sum < 0) sum += USHRT_MAX;
  return sum;
}

/** 通訊密碼（數字）＋ session id → 4 bytes 驗證碼（與 ZKTeco 官方 SDK 相同的算法） */
function makeCommKey(key, sessionId, ticks = 50) {
  key = Number(key) >>> 0;
  let k = 0;
  for (let i = 0; i < 32; i++) k = ((k << 1) | ((key >>> i) & 1)) >>> 0;
  k = (k + sessionId) >>> 0;
  const b = Buffer.alloc(4);
  b.writeUInt32LE(k);
  const x = [b[0] ^ 0x5a, b[1] ^ 0x4b, b[2] ^ 0x53, b[3] ^ 0x4f]; // 'Z' 'K' 'S' 'O'
  const s = [x[2], x[3], x[0], x[1]]; // 兩個 16-bit 對調
  const B = ticks & 0xff;
  return Buffer.from([s[0] ^ B, s[1] ^ B, B, s[3] ^ B]);
}

function decodeTime(t) {
  const second = t % 60; t = Math.floor(t / 60);
  const minute = t % 60; t = Math.floor(t / 60);
  const hour = t % 24; t = Math.floor(t / 24);
  const day = (t % 31) + 1; t = Math.floor(t / 31);
  const month = (t % 12) + 1; t = Math.floor(t / 12);
  return { year: t + 2000, month, day, hour, minute, second };
}

function cstr(buf) {
  const end = buf.indexOf(0);
  const b = end >= 0 ? buf.subarray(0, end) : buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b).trim();
  } catch {
    try {
      return new TextDecoder('windows-874').decode(b).trim();
    } catch {
      return b.toString('latin1').trim();
    }
  }
}

export class ZkClient {
  constructor({ ip, port = 4370, timeoutMs = 15000 }) {
    this.ip = ip;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.session = 0;
    this.reply = USHRT_MAX - 1;
    this.buf = Buffer.alloc(0);
    this.waiters = [];
  }

  open() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.ip, port: this.port });
      const t = setTimeout(() => {
        sock.destroy();
        reject(new Error(`連不上打卡機 ${this.ip}:${this.port}（逾時）`));
      }, this.timeoutMs);
      sock.once('connect', () => {
        clearTimeout(t);
        resolve();
      });
      sock.on('error', (e) => {
        clearTimeout(t);
        this.fail(e);
        reject(new Error(`連不上打卡機 ${this.ip}:${this.port}：${e.message}`));
      });
      sock.on('close', () => this.fail(new Error('打卡機中斷了連線')));
      sock.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        this.pump();
      });
      this.sock = sock;
    });
  }

  fail(err) {
    for (const w of this.waiters.splice(0)) w.reject(err);
  }

  // 依 TCP 外框（0x5050 0x7D82 + 長度）切出一個個封包
  pump() {
    while (this.waiters.length && this.buf.length >= 8) {
      if (this.buf.readUInt16LE(0) !== 0x5050 || this.buf.readUInt16LE(2) !== 0x7d82) {
        this.fail(new Error('打卡機回傳的資料格式不正確'));
        this.buf = Buffer.alloc(0);
        return;
      }
      const len = this.buf.readUInt32LE(4);
      if (this.buf.length < 8 + len) return;
      const pkt = this.buf.subarray(8, 8 + len);
      this.buf = this.buf.subarray(8 + len);
      const w = this.waiters.shift();
      clearTimeout(w.timer);
      w.resolve({ code: pkt.readUInt16LE(0), session: pkt.readUInt16LE(4), reply: pkt.readUInt16LE(6), data: pkt.subarray(8) });
    }
  }

  recv() {
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error('等待打卡機回應逾時'));
      }, this.timeoutMs);
      this.waiters.push(w);
      this.pump();
    });
  }

  async send(command, data = Buffer.alloc(0)) {
    const head = Buffer.alloc(8);
    head.writeUInt16LE(command, 0);
    head.writeUInt16LE(0, 2);
    head.writeUInt16LE(this.session, 4);
    head.writeUInt16LE(this.reply, 6);
    const sum = checksum(Buffer.concat([head, data]));
    this.reply += 1;
    if (this.reply >= USHRT_MAX) this.reply -= USHRT_MAX;
    head.writeUInt16LE(sum, 2);
    head.writeUInt16LE(this.reply, 6);
    const pkt = Buffer.concat([head, data]);
    const top = Buffer.alloc(8);
    top.writeUInt16LE(0x5050, 0);
    top.writeUInt16LE(0x7d82, 2);
    top.writeUInt32LE(pkt.length, 4);
    this.sock.write(Buffer.concat([top, pkt]));
    const res = await this.recv();
    this.reply = res.reply;
    return res;
  }

  /** 連線；機器有設通訊密碼時，commKey 一定要正確，否則丟出錯誤（不會重試，避免被機器鎖住） */
  async connect(commKey = 0) {
    await this.open();
    const r = await this.send(CMD_CONNECT);
    this.session = r.session;
    if (r.code === CMD_ACK_UNAUTH) {
      if (!Number(commKey)) {
        const e = new Error('打卡機需要通訊密碼（config.json 的 device.commKey 還沒填）');
        e.needAuth = true;
        throw e;
      }
      const a = await this.send(CMD_AUTH, makeCommKey(commKey, this.session));
      if (a.code !== CMD_ACK_OK) {
        const e = new Error(`通訊密碼不正確（打卡機回應 ${a.code}），請確認 device.commKey`);
        e.needAuth = true;
        throw e;
      }
    } else if (r.code !== CMD_ACK_OK) {
      throw new Error(`打卡機拒絕連線（回應 ${r.code}）`);
    }
  }

  async disconnect() {
    try {
      if (this.sock && !this.sock.destroyed) await this.send(CMD_EXIT);
    } catch {
      /* 結束時的錯誤不影響結果 */
    }
    this.sock?.destroy();
  }

  async readSizes() {
    const r = await this.send(CMD_GET_FREE_SIZES, Buffer.alloc(0));
    if (r.code !== CMD_ACK_OK || r.data.length < 80) throw new Error('讀取打卡機容量資訊失敗');
    const f = (i) => r.data.readInt32LE(i * 4);
    return { users: f(4), fingers: f(6), records: f(8) };
  }

  async readChunk(start, size) {
    const arg = Buffer.alloc(8);
    arg.writeInt32LE(start, 0);
    arg.writeInt32LE(size, 4);
    const r = await this.send(CMD_READ_BUFFER, arg);
    if (r.code === CMD_DATA) return r.data;
    if (r.code !== CMD_PREPARE_DATA) throw new Error(`讀取資料失敗（回應 ${r.code}）`);
    const total = r.data.readUInt32LE(0);
    const parts = [];
    let got = 0;
    while (got < total) {
      const p = await this.recv();
      if (p.code !== CMD_DATA) throw new Error(`讀取資料中斷（回應 ${p.code}）`);
      parts.push(p.data);
      got += p.data.length;
    }
    const end = await this.recv();
    if (end.code !== CMD_ACK_OK) throw new Error(`讀取資料未正常結束（回應 ${end.code}）`);
    return Buffer.concat(parts);
  }

  async readWithBuffer(command, fct = 0, ext = 0) {
    const arg = Buffer.alloc(11);
    arg.writeInt8(1, 0);
    arg.writeInt16LE(command, 1);
    arg.writeInt32LE(fct, 3);
    arg.writeInt32LE(ext, 7);
    const r = await this.send(CMD_PREPARE_BUFFER, arg);
    if (r.code === CMD_DATA) return r.data;
    if (r.code !== CMD_ACK_OK) throw new Error(`打卡機不支援緩衝讀取（回應 ${r.code}）`);
    const size = r.data.readUInt32LE(1);
    const parts = [];
    for (let start = 0; start < size; start += MAX_CHUNK) parts.push(await this.readChunk(start, Math.min(MAX_CHUNK, size - start)));
    await this.send(CMD_FREE_DATA);
    return Buffer.concat(parts);
  }

  /** 人員：{ userId（機器上的人員代碼）, name } */
  async getUsers(count) {
    if (!count) return [];
    const raw = await this.readWithBuffer(CMD_USERTEMP_RRQ, FCT_USER);
    const total = raw.readUInt32LE(0);
    const data = raw.subarray(4);
    const recSize = Math.floor(total / count);
    const out = [];
    for (let o = 0; o + recSize <= data.length; o += recSize) {
      const r = data.subarray(o, o + recSize);
      if (recSize === 28) out.push({ userId: String(r.readUInt32LE(24)), name: cstr(r.subarray(8, 16)) });
      else out.push({ userId: cstr(r.subarray(48, 72)), name: cstr(r.subarray(11, 35)) });
    }
    return out;
  }

  /** 打卡紀錄：{ userId, time:{year…second}, status（驗證方式）, punch（進/出） } */
  async getAttendance(count) {
    if (!count) return [];
    const raw = await this.readWithBuffer(CMD_ATTLOG_RRQ);
    const total = raw.readUInt32LE(0);
    const data = raw.subarray(4);
    const recSize = Math.floor(total / count);
    const out = [];
    for (let o = 0; o + recSize <= data.length; o += recSize) {
      const r = data.subarray(o, o + recSize);
      if (recSize === 8) out.push({ userId: String(r.readUInt16LE(0)), status: r[2], time: decodeTime(r.readUInt32LE(3)), punch: r[7] });
      else if (recSize === 16) out.push({ userId: String(r.readUInt32LE(0)), time: decodeTime(r.readUInt32LE(4)), status: r[8], punch: r[9] });
      else out.push({ userId: cstr(r.subarray(2, 26)), status: r[26], time: decodeTime(r.readUInt32LE(27)), punch: r[31] });
    }
    return out;
  }
}

/** ZKTeco 驗證方式代碼 → 跟匯出 CSV 一樣的文字 */
export function verifyLabel(status) {
  if (status === 1) return 'FP';
  if (status === 15) return 'FACE';
  if (status === 0) return 'PWD';
  if (status === 2 || status === 4) return 'CARD';
  return String(status);
}

'use client';

import { Fragment, useEffect, useState } from 'react';
import type * as XLSXNS from 'xlsx';
import ExcelUploadButton from '@/components/ExcelUploadButton';
import TemplateDownloadButton from '@/components/TemplateDownloadButton';
import {
  LetterCategory,
  ServiceCertRow,
  RENEWAL_STATUSES,
  RenewalStatus,
  MergedAppointmentRow,
  downloadServiceCertTemplate,
  uploadServiceCertSheet,
  fetchCurrentServiceCertSheet,
  listServiceCertRows,
  listMergedAppointmentRows,
  saveServiceCertRow,
  saveMergedAppointmentRow,
  deleteServiceCertRow,
  deleteAppointmentLetterRow,
  computeServiceDuration,
  defaultTermDatesForCategory,
} from '@/lib/teacherLetters';
import { getTeacherLetterSettings, saveTeacherLetterSettings, TeacherLetterSettings } from '@/lib/teacherLetterSettings';
import { buildCertificateContent, buildAppointmentContent } from '@/lib/teacherLetterContent';
import { buildTeacherLetterCompareReport, CompareReport } from '@/lib/teacherLetterCompare';
import { supabase } from '@/lib/supabaseClient';
import { showPdfInWindow } from '@/lib/pdfPreview';

// 開發人員區「聘書」：把「0808.xlsm」（原本用Excel VBA巨集手動列印）的邏輯搬到網頁上，
// 「歷年教師資料」「自聘教師資料」「當年教師資料」3張資料表改成網頁管理，提供「下載範本」
// 「下載目前資料」「批次上傳（同姓名重複上傳＝批次修正既有資料，不會產生重複列）」
// 「逐筆編輯／刪除」，取代原本要開Excel按巨集的流程。
// 「自聘教師資料」「當年教師資料」的姓名/職位/性別直接來自「歷年教師資料」的自聘勾選結果
// （自聘勾了就出現在自聘教師資料、沒勾且沒有離職才出現在當年教師資料），不用另外重複輸入
// 一次姓名資料，只需要各自補聘期/起迄/發聘時間這些聘書專屬欄位（聘期起迄有預設值，見
// lib/teacherLetters.ts 的 defaultTermDatesForCategory）。「歷年教師資料」會自動結算在職
// 總年數/月數/日數（比照原檔R/S/T三欄公式，見 lib/teacherLetters.ts 的 computeServiceDuration）。
// 「在職證明」「自聘教師聘書」「當年聘書」這三份文件合併在下方的「列印」分頁，直接產生
// PDF／Word（不是Excel），文字內容逐條比對「0808.xlsm」的公式搬過來（見
// lib/teacherLetterContent.ts），校名/校長/董事長/電話/地址這些固定資料在「列印」分頁可以
// 直接編輯、存進資料庫（見 lib/teacherLetterSettings.ts），不用再改程式碼。

type PanelTab = '歷年教師資料' | '比對報表' | '列印';

const CATEGORIES: { key: PanelTab; label: string }[] = [
  { key: '歷年教師資料', label: '歷年教師資料' },
  { key: '比對報表', label: '比對報表' },
  { key: '列印', label: '列印' },
];

async function downloadSheet(sheet: { name: string; aoa: any[][] }) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
  XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  XLSX.writeFile(wb, `${sheet.name}.xlsx`);
}

async function readFirstSheetRows(file: File): Promise<any[][]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
}

export default function TeacherLettersPanel({ userId }: { userId: string | null }) {
  const [tab, setTab] = useState<PanelTab>('歷年教師資料');

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setTab(c.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--primary)',
              background: tab === c.key ? 'var(--primary)' : 'var(--surface)',
              color: tab === c.key ? '#fff' : 'var(--primary-ink)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {tab === '歷年教師資料' ? (
        <ServiceCertSection userId={userId} />
      ) : tab === '比對報表' ? (
        <CompareSection />
      ) : (
        <PrintSection userId={userId} />
      )}
    </div>
  );
}

/* ============================================================ */
/* 比對報表：歷年教師資料 vs 帳號管理／教師名單／班級導師（只讀不寫，用姓名比對）   */
/* ============================================================ */

function CompareSection() {
  const [report, setReport] = useState<CompareReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setLoading(true);
    setError('');
    try {
      setReport(await buildTeacherLetterCompareReport());
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
    setLoading(false);
  }
  useEffect(() => {
    run();
  }, []);

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 0 }}>
        以歷年教師資料的「對應帳號」為準，逐一核對帳號管理、教師名單、班級導師，只列出對不起來的地方，不會修改任何資料。
        「未對應帳號」請到歷年教師資料編輯、選擇對應帳號即可消除。
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={run} disabled={loading} style={{ padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}>
          {loading ? '比對中…' : '重新比對'}
        </button>
        {report && report.issues.length > 0 && (
          <button
            type="button"
            style={{ padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}
            onClick={() =>
              downloadSheet({
                name: '聘書比對報表',
                aoa: [['類型', '姓名', '說明'], ...report.issues.map((i) => [i.kind, i.name, i.detail])],
              })
            }
          >
            下載 Excel
          </button>
        )}
      </div>
      {error && <p style={{ color: '#A32D2D', fontSize: 13 }}>比對失敗：{error}</p>}
      {report && (
        <>
          <p style={{ fontSize: 13 }}>
            歷年教師資料 {report.counts.certs} 筆（在職 {report.counts.activeCerts}、已對應帳號 {report.counts.linked}）｜帳號 {report.counts.accounts} 個｜教師名單 {report.counts.teachers} 人｜
            {report.academicYear ?? '—'} 學年導師 {report.counts.homerooms} 人
          </p>
          {report.issues.length === 0 ? (
            <p style={{ color: '#2E7D32', fontSize: 13 }}>全部對得起來，沒有差異。</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
              <thead>
                <tr style={{ background: '#f2f6fa' }}>
                  <th style={{ textAlign: 'left', padding: 6, border: '1px solid var(--line-strong)' }}>類型</th>
                  <th style={{ textAlign: 'left', padding: 6, border: '1px solid var(--line-strong)' }}>姓名</th>
                  <th style={{ textAlign: 'left', padding: 6, border: '1px solid var(--line-strong)' }}>說明</th>
                </tr>
              </thead>
              <tbody>
                {[...report.issues]
                  .sort((a, b) => a.kind.localeCompare(b.kind, 'zh-Hant') || a.name.localeCompare(b.name, 'zh-Hant'))
                  .map((i, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: 6, border: '1px solid var(--line-strong)', whiteSpace: 'nowrap' }}>{i.kind}</td>
                      <td style={{ padding: 6, border: '1px solid var(--line-strong)' }}>{i.name}</td>
                      <td style={{ padding: 6, border: '1px solid var(--line-strong)' }}>{i.detail}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================ */
/* 歷年教師資料（原「在職證明」）                                          */
/* ============================================================ */

const EMPTY_CERT: ServiceCertRow = {
  app_user_id: null, teacher_id: null, email: null, renewal_status: '待定',
  seq_no: null, self_hired: false, resigned: false, name: '', birth_date: null, nationality: null,
  gender: null, department: null, title: null,
  start_date_1: null, end_date_1: null, start_date_2: null, end_date_2: null, start_date_3: null, end_date_3: null,
  note: null,
};

type AccountOption = { id: string; name: string; role: string };

function ServiceCertSection({ userId }: { userId: string | null }) {
  const [rows, setRows] = useState<ServiceCertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ServiceCertRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [teacherByUser, setTeacherByUser] = useState<Map<string, string>>(new Map());

  async function reload() {
    setLoading(true);
    const [list, usersRes, teachersRes] = await Promise.all([
      listServiceCertRows(),
      supabase.from('app_users').select('id, name, role').order('name'),
      supabase.from('teachers').select('id, app_user_id'),
    ]);
    setRows(list);
    setAccounts((usersRes.data ?? []) as AccountOption[]);
    setTeacherByUser(new Map(((teachersRes.data ?? []) as { id: string; app_user_id: string | null }[]).filter((t) => t.app_user_id).map((t) => [t.app_user_id as string, t.id])));
    setLoading(false);
  }
  useEffect(() => {
    reload();
  }, []);

  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '';
  // 已經對應給其他聘書資料的帳號不能重複選（資料庫也有唯一限制）
  const accountChoices = (selfId: string | undefined) => {
    const used = new Set(rows.filter((r) => r.id !== selfId && r.app_user_id).map((r) => r.app_user_id as string));
    return accounts.filter((a) => !used.has(a.id));
  };

  async function handleUploadFile(file: File) {
    const rowsRaw = await readFirstSheetRows(file);
    const result = await uploadServiceCertSheet(rowsRaw, userId);
    reload();
    return result;
  }

  async function handleDownloadCurrent() {
    const sheet = await fetchCurrentServiceCertSheet();
    downloadSheet(sheet);
  }

  async function handleSave(row: ServiceCertRow) {
    if (!row.name.trim()) {
      alert('姓名必填');
      return;
    }
    const { error } = await saveServiceCertRow(row, userId);
    if (error) {
      alert('儲存失敗：' + error);
      return;
    }
    setEditing(null);
    setAdding(false);
    reload();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`確定要刪除「${name}」這筆歷年教師資料嗎？`)) return;
    const { error } = await deleteServiceCertRow(id);
    if (error) alert('刪除失敗：' + error);
    reload();
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 8 }}>
        欄位比照原「教師資料+VBA列印」活頁簿的「在職證明」工作表（已改名「歷年教師資料」）：
        任職/離職日期最多3段（供中途離職又回聘的情況使用），下方列表的「在職時間」欄位是自動結算的總年數/月數/日數。
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <TemplateDownloadButton label="下載歷年教師資料範本" onClick={downloadServiceCertTemplate} />
        <TemplateDownloadButton label="下載目前資料(現況)" onClick={handleDownloadCurrent} />
      </div>
      <ExcelUploadButton label="批次上傳／修正歷年教師資料（同姓名重複上傳＝更新既有資料，不會產生重複列）" onFile={handleUploadFile} />

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setEditing({ ...EMPTY_CERT });
          }}
          style={{ padding: '6px 14px', fontSize: 13, marginBottom: 10, cursor: 'pointer' }}
        >
          ＋ 新增一筆
        </button>

        {adding && editing && (
          <ServiceCertForm row={editing} accountChoices={accountChoices(undefined)} teacherByUser={teacherByUser} onChange={setEditing} onSave={() => handleSave(editing)} onCancel={() => { setAdding(false); setEditing(null); }} />
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--sub)' }}>載入中…</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr style={{ background: 'var(--primary-soft)' }}>
                  {['序號', '自聘', '離職', '姓名', '國籍', '性別', '服務部門', '職稱', '任職期間', '在職時間', '聘用結果', '對應帳號', ''].map((h) => (
                    <th key={h} style={{ border: '1px solid var(--line-strong)', padding: 6, textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td style={tdStyle}>{r.seq_no ?? ''}</td>
                      <td style={tdStyle}>{r.self_hired ? 'V' : ''}</td>
                      <td style={tdStyle}>{r.resigned ? 'V' : ''}</td>
                      <td style={tdStyle}>{r.name}</td>
                      <td style={tdStyle}>{r.nationality}</td>
                      <td style={tdStyle}>{r.gender}</td>
                      <td style={tdStyle}>{r.department}</td>
                      <td style={tdStyle}>{r.title}</td>
                      <td style={tdStyle}>
                        {r.start_date_1 ?? ''} ~ {r.end_date_1 ?? '(在職)'}
                        {r.start_date_2 ? `；${r.start_date_2} ~ ${r.end_date_2 ?? '(在職)'}` : ''}
                        {r.start_date_3 ? `；${r.start_date_3} ~ ${r.end_date_3 ?? '(在職)'}` : ''}
                      </td>
                      <td style={tdStyle}>{computeServiceDuration(r, new Date()).label}</td>
                      <td style={{ ...tdStyle, color: r.renewal_status === '不續聘' ? '#A32D2D' : r.renewal_status === '已發聘' ? '#2E7D32' : 'var(--sub)' }}>{r.renewal_status}</td>
                      <td style={tdStyle}>
                        {r.app_user_id ? (
                          <>
                            {accountName(r.app_user_id)}
                            {r.email && <div style={{ fontSize: 11, color: 'var(--sub)' }}>{r.email}</div>}
                          </>
                        ) : (
                          <span style={{ color: r.resigned ? 'var(--sub)' : '#b26a00' }}>{r.resigned ? '—' : '未對應'}</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() => { setAdding(false); setEditing(editing?.id === r.id ? null : { ...r }); }}
                          style={{ fontSize: 12, marginRight: 6, cursor: 'pointer' }}
                        >
                          {editing?.id === r.id ? '取消' : '編輯'}
                        </button>
                        <button type="button" onClick={() => r.id && handleDelete(r.id, r.name)} style={{ fontSize: 12, color: '#A32D2D', cursor: 'pointer' }}>
                          刪除
                        </button>
                      </td>
                    </tr>
                    {!adding && editing?.id === r.id && (
                      <tr>
                        <td colSpan={13}>
                          <ServiceCertForm row={editing} accountChoices={accountChoices(editing.id)} teacherByUser={teacherByUser} onChange={setEditing} onSave={() => handleSave(editing)} onCancel={() => setEditing(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={13} style={{ ...tdStyle, color: 'var(--sub)', textAlign: 'center' }}>目前沒有資料</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const tdStyle: React.CSSProperties = { border: '1px solid var(--line)', padding: 6 };
const inputStyle: React.CSSProperties = { padding: 4, fontSize: 12, width: '100%', boxSizing: 'border-box' };

function ServiceCertForm({
  row, accountChoices, teacherByUser, onChange, onSave, onCancel,
}: {
  row: ServiceCertRow;
  accountChoices: AccountOption[];
  teacherByUser: Map<string, string>;
  onChange: (r: ServiceCertRow) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<ServiceCertRow>) => onChange({ ...row, ...patch });
  return (
    <div style={{ border: '1px solid var(--line-strong)', borderRadius: 6, padding: 12, marginBottom: 12, background: 'var(--primary-soft)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        <label>歷年序號<input style={inputStyle} type="number" value={row.seq_no ?? ''} onChange={(e) => set({ seq_no: e.target.value ? Number(e.target.value) : null })} /></label>
        <label>姓名*<input style={inputStyle} value={row.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label>國籍<input style={inputStyle} value={row.nationality ?? ''} onChange={(e) => set({ nationality: e.target.value || null })} /></label>
        <label>性別<input style={inputStyle} value={row.gender ?? ''} onChange={(e) => set({ gender: e.target.value || null })} /></label>
        <label>服務部門<input style={inputStyle} value={row.department ?? ''} onChange={(e) => set({ department: e.target.value || null })} /></label>
        <label>職稱<input style={inputStyle} value={row.title ?? ''} onChange={(e) => set({ title: e.target.value || null })} /></label>
        <label>出生日期<input style={inputStyle} type="date" value={row.birth_date ?? ''} onChange={(e) => set({ birth_date: e.target.value || null })} /></label>
        <label>聘用結果
          <select style={inputStyle} value={row.renewal_status} onChange={(e) => set({ renewal_status: e.target.value as RenewalStatus })}>
            {RENEWAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>對應帳號
          <select
            style={inputStyle}
            value={row.app_user_id ?? ''}
            onChange={(e) => {
              const uid = e.target.value || null;
              set({ app_user_id: uid, teacher_id: uid ? teacherByUser.get(uid) ?? null : null, email: uid === row.app_user_id ? row.email : null });
            }}
          >
            <option value="">（未對應）</option>
            {accountChoices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={row.self_hired} onChange={(e) => set({ self_hired: e.target.checked })} /> 自聘
        </label>
        <label>
          <input type="checkbox" checked={row.resigned} onChange={(e) => set({ resigned: e.target.checked })} /> 離職
        </label>
        <label>任職日期1<input style={inputStyle} type="date" value={row.start_date_1 ?? ''} onChange={(e) => set({ start_date_1: e.target.value || null })} /></label>
        <label>離職日期1<input style={inputStyle} type="date" value={row.end_date_1 ?? ''} onChange={(e) => set({ end_date_1: e.target.value || null })} /></label>
        <label>任職日期2<input style={inputStyle} type="date" value={row.start_date_2 ?? ''} onChange={(e) => set({ start_date_2: e.target.value || null })} /></label>
        <label>離職日期2<input style={inputStyle} type="date" value={row.end_date_2 ?? ''} onChange={(e) => set({ end_date_2: e.target.value || null })} /></label>
        <label>任職日期3<input style={inputStyle} type="date" value={row.start_date_3 ?? ''} onChange={(e) => set({ start_date_3: e.target.value || null })} /></label>
        <label>離職日期3<input style={inputStyle} type="date" value={row.end_date_3 ?? ''} onChange={(e) => set({ end_date_3: e.target.value || null })} /></label>
        <label style={{ gridColumn: '1 / -1' }}>備註<input style={inputStyle} value={row.note ?? ''} onChange={(e) => set({ note: e.target.value || null })} /></label>
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" onClick={onSave} style={{ padding: '5px 14px', fontSize: 12, marginRight: 8, cursor: 'pointer' }}>儲存</button>
        <button type="button" onClick={onCancel} style={{ padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}>取消</button>
      </div>
    </div>
  );
}

/* ============================================================ */
/* 聘書聘期（自聘教師聘書 ／ 當年教師聘書）                              */
/* ============================================================ */

// 【改版】原本的「自聘教師資料」「當年教師資料」兩個分頁已拿掉：名單本來就是從歷年教師資料
// 推出來的，聘期／起迄／發聘時間這些聘書專屬欄位改成直接在「列印」分頁每一列編輯，
// 沒編輯過就用預設值。資料表（teacher_appointment_letters）沒有動。
// 聘期預設值（自聘＝下一年1/1~12/31；當年＝今年5/1~明年4/30）統一放在
// lib/teacherLetters.ts 的 defaultTermDatesForCategory()（批次上傳沒填起迄時也是用同一套），
// 這裡的 applyDefaultTermDates 只在起迄都沒填時套用預設值，不會覆蓋已填的資料。
function applyDefaultTermDates(row: MergedAppointmentRow): MergedAppointmentRow {
  if (row.start_date || row.end_date) return { ...row };
  return { ...row, ...defaultTermDatesForCategory(row.category) };
}

function PrintSection({ userId }: { userId: string | null }) {
  const [category, setCategory] = useState<LetterCategory | '在/離職證明'>('在/離職證明');
  const [certRows, setCertRows] = useState<ServiceCertRow[]>([]);
  const [letterRows, setLetterRows] = useState<MergedAppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  // 正在產生的檔案（`${歷年教師資料id}:${格式}`），同一時間只允許產生一份
  const [generating, setGenerating] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<MergedAppointmentRow | null>(null);

  const [settings, setSettings] = useState<TeacherLetterSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    getTeacherLetterSettings().then(setSettings);
  }, []);

  async function reload() {
    setLoading(true);
    if (category === '在/離職證明') setCertRows(await listServiceCertRows());
    else setLetterRows(await listMergedAppointmentRows(category));
    setLoading(false);
  }
  useEffect(() => {
    setEditingId(null);
    setEditingRow(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  async function handleSaveSettings() {
    if (!settings) return;
    setSavingSettings(true);
    const { error } = await saveTeacherLetterSettings(settings, userId);
    setSavingSettings(false);
    if (error) alert('儲存失敗：' + error);
  }

  async function handleSaveLetter(row: MergedAppointmentRow) {
    const { error } = await saveMergedAppointmentRow(row, userId);
    if (error) {
      alert('儲存失敗：' + error);
      return;
    }
    setEditingId(null);
    setEditingRow(null);
    reload();
  }

  async function handleClearLetter(row: MergedAppointmentRow) {
    if (!row.letter_id) return;
    if (!confirm(`確定要清除「${row.name}」自訂的聘期/起迄資料嗎？（教師本身不會被刪除，清除後列印會改用預設值）`)) return;
    const { error } = await deleteAppointmentLetterRow(row.letter_id);
    if (error) alert('清除失敗：' + error);
    reload();
  }

  async function handleGenerate(format: 'pdf' | 'docx', certId: string) {
    if (!settings) {
      alert('學校固定資料還在載入，請稍後再試');
      return;
    }
    // 【2026-08-19】PDF 改成呼叫伺服器端 API（見 app/api/reports/teacher-letter/route.tsx
    // 的說明：原本在瀏覽器端直接產生 PDF，中文字型在瀏覽器環境讀不到，是「Unknown font
    // format」的根因）。這裡也順便把「強制下載」改成「開新分頁預覽（可以直接列印）」，
    // 跟成績單的列印功能一致；window.open 一樣要在還沒有任何 await 之前先同步呼叫，
    // 不然會被瀏覽器的彈出視窗封鎖機制擋掉又沒有任何提示（同一個坑，見成績單那邊的
    // 說明）。docx 檔案本來就是「下載」而不是「預覽列印」的性質，維持原本下載的做法。
    const printWindow = format === 'pdf' ? window.open('', '_blank') : null;
    if (format === 'pdf' && !printWindow) {
      alert('瀏覽器擋下了新分頁（彈出視窗封鎖），請到瀏覽器網址列允許本網站開啟彈出視窗後再試一次。');
      return;
    }
    if (printWindow) {
      printWindow.document.write('<p style="font-family:sans-serif;padding:24px">正在產生 PDF，請稍候…</p>');
    }
    setGenerating(`${certId}:${format}`);
    try {
      const calcDate = new Date();
      let fileBase = '';
      let blob: Blob;
      let pdfKind: 'certificate' | 'appointment' | null = null;
      let pdfContent: any = null;

      if (category === '在/離職證明') {
        const row = certRows.find((r) => r.id === certId);
        if (!row) throw new Error('找不到選取的教師，請重新整理後再試');
        // 離職證明要有離職日期：已勾離職、但最後一段任職沒有離職日期，印出來會變成「至今」，先擋下來
        if (row.resigned) {
          const lastOpen = row.start_date_3 ? !row.end_date_3 : row.start_date_2 ? !row.end_date_2 : !row.end_date_1;
          if (lastOpen) throw new Error(`「${row.name}」已勾選離職，但最後一段任職沒有填離職日期，請先到「歷年教師資料」補上`);
        }
        const content = buildCertificateContent(row, settings, calcDate);
        fileBase = `${row.resigned ? '離職' : '在職'}證明_${row.name}`;
        if (format === 'pdf') {
          pdfKind = 'certificate';
          pdfContent = content;
        } else {
          const { buildCertificateDocxBlob } = await import('@/lib/TeacherLetterDocx');
          blob = await buildCertificateDocxBlob(content);
        }
      } else {
        const found = letterRows.find((r) => r.cert_id === certId);
        if (!found) throw new Error('找不到選取的教師，請重新整理後再試');
        // 起迄都沒填過就套用預設值（跟編輯表單、批次上傳是同一套預設）
        const row = applyDefaultTermDates(found);
        const content = buildAppointmentContent(row, settings, calcDate);
        fileBase = `${category}_${row.name}`;
        if (format === 'pdf') {
          pdfKind = 'appointment';
          pdfContent = content;
        } else {
          const { buildAppointmentDocxBlob } = await import('@/lib/TeacherLetterDocx');
          blob = await buildAppointmentDocxBlob(content);
        }
      }

      if (format === 'pdf' && pdfKind) {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
          printWindow?.close();
          alert('請重新登入');
          return;
        }
        const res = await fetch('/api/reports/teacher-letter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ kind: pdfKind, content: pdfContent, fileBase }),
        });
        if (!res.ok) {
          printWindow?.close();
          const body = await res.json().catch(() => ({}));
          alert(`產生列印檔失敗，狀態碼 ${res.status}${body.error ? '：' + body.error : ''}`);
          return;
        }
        blob = await res.blob();
        if (printWindow) {
          showPdfInWindow(printWindow, blob, '教師信函');
        }
        return;
      }

      const url = URL.createObjectURL(blob!);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBase}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      printWindow?.close();
      alert('產生列印檔失敗：' + err.message);
    } finally {
      setGenerating('');
    }
  }

  const isSelfHired = category === '自聘教師聘書';
  const printButtons = (certId: string) => (
    <>
      <button type="button" onClick={() => handleGenerate('pdf', certId)} disabled={generating !== ''} style={{ fontSize: 12, marginRight: 6, cursor: 'pointer' }}>
        {generating === `${certId}:pdf` ? '產生中…' : 'PDF'}
      </button>
      <button type="button" onClick={() => handleGenerate('docx', certId)} disabled={generating !== ''} style={{ fontSize: 12, marginRight: 6, cursor: 'pointer' }}>
        {generating === `${certId}:docx` ? '產生中…' : 'Word'}
      </button>
    </>
  );

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 12 }}>
        文字內容比對「0808.xlsm」的「印在職證明」「印自聘教師聘書」「印當年聘書」逐條實作，直接產生 PDF 或 Word 檔（不是Excel），下載後就是完整格式，不需要再另外開Excel計算公式。
        在/離職證明依「歷年教師資料」的離職勾選自動選擇：仍在職印「在職證明書」，已離職印「離職證明書」（需先填好離職日期）。
        人員資料請在「歷年教師資料」維護；這裡依「自聘」勾選與聘用結果自動列出該印聘書的人，聘期沒特別設定就用預設值。
      </p>

      {settings && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 16, background: 'var(--primary-soft)' }}>
          <p style={{ fontSize: 13, marginBottom: 8, fontWeight: 600 }}>學校固定資料（校名/校長/董事長/電話/地址，所有人列印都會用這裡的值）</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 8 }}>
            <label>校名<input style={inputStyle} value={settings.school_name_zh} onChange={(e) => setSettings({ ...settings, school_name_zh: e.target.value })} /></label>
            <label>校長姓名<input style={inputStyle} value={settings.principal_name} onChange={(e) => setSettings({ ...settings, principal_name: e.target.value })} /></label>
            <label>董事長姓名<input style={inputStyle} value={settings.chairman_name} onChange={(e) => setSettings({ ...settings, chairman_name: e.target.value })} /></label>
            <label>聯絡電話<input style={inputStyle} value={settings.phone} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} /></label>
            <label style={{ gridColumn: '1 / -1' }}>地址<input style={inputStyle} value={settings.address} onChange={(e) => setSettings({ ...settings, address: e.target.value })} /></label>
          </div>
          <button type="button" onClick={handleSaveSettings} disabled={savingSettings} style={{ padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}>
            {savingSettings ? '儲存中…' : '儲存'}
          </button>
          <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 6 }}>
            說明：印自聘教師聘書／當年聘書時，如果被印的人剛好就是「校長姓名」本人，落款會自動改成「董事長」簽署（原本活頁簿就是這樣設計的，避免校長替自己簽聘書）。
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['在/離職證明', '自聘教師聘書', '當年教師聘書'] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid var(--primary)', fontSize: 12, cursor: 'pointer',
              background: category === c ? 'var(--primary)' : 'var(--surface)', color: category === c ? '#fff' : 'var(--primary-ink)',
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {category !== '在/離職證明' && (
        <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 8 }}>
          {isSelfHired
            ? '名單：「歷年教師資料」有勾選「自聘」、且聘用結果不是「不續聘」的教師。'
            : '名單：「歷年教師資料」尚未離職、且聘用結果不是「不續聘」的教師（自聘教師也算在內）。'}
          少了應該出現的人，請先到「歷年教師資料」確認勾選與聘用結果。
        </p>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--sub)' }}>載入中…</p>
      ) : category === '在/離職證明' ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--primary-soft)' }}>
                {['序號', '姓名', '職稱', '狀態（印哪一種）', '列印'].map((h) => (
                  <th key={h} style={{ border: '1px solid var(--line-strong)', padding: 6, textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {certRows.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.seq_no ?? ''}</td>
                  <td style={tdStyle}>{r.name}</td>
                  <td style={tdStyle}>{r.title}</td>
                  <td style={tdStyle}>{r.resigned ? '已離職 → 離職證明' : '在職 → 在職證明'}</td>
                  <td style={tdStyle}>{r.id && printButtons(r.id)}</td>
                </tr>
              ))}
              {certRows.length === 0 && (
                <tr><td colSpan={5} style={{ ...tdStyle, color: 'var(--sub)', textAlign: 'center' }}>「歷年教師資料」目前沒有資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--primary-soft)' }}>
                {['序號', '姓名', '職稱', '聘期(年)', '起', '迄', ...(isSelfHired ? ['發聘時間'] : []), '列印／編輯'].map((h) => (
                  <th key={h} style={{ border: '1px solid var(--line-strong)', padding: 6, textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {letterRows.map((r) => {
                const eff = applyDefaultTermDates(r);
                const usingDefault = !r.start_date && !r.end_date;
                return (
                  <Fragment key={r.cert_id}>
                    <tr>
                      <td style={tdStyle}>{r.seq_no ?? ''}</td>
                      <td style={tdStyle}>{r.name}</td>
                      <td style={tdStyle}>{r.title}</td>
                      <td style={tdStyle}>{r.term_no ?? ''}</td>
                      <td style={{ ...tdStyle, color: usingDefault ? 'var(--sub)' : undefined }}>{eff.start_date}</td>
                      <td style={{ ...tdStyle, color: usingDefault ? 'var(--sub)' : undefined }}>{eff.end_date}</td>
                      {isSelfHired && <td style={tdStyle}>{r.issued_date}</td>}
                      <td style={tdStyle}>
                        {printButtons(r.cert_id)}
                        <button
                          type="button"
                          onClick={() => {
                            if (editingId === r.cert_id) {
                              setEditingId(null);
                              setEditingRow(null);
                            } else {
                              setEditingId(r.cert_id);
                              setEditingRow(applyDefaultTermDates(r));
                            }
                          }}
                          style={{ fontSize: 12, marginRight: 6, cursor: 'pointer' }}
                        >
                          {editingId === r.cert_id ? '取消' : '編輯聘期'}
                        </button>
                        {r.letter_id && (
                          <button type="button" onClick={() => handleClearLetter(r)} style={{ fontSize: 12, color: '#A32D2D', cursor: 'pointer' }}>
                            還原預設
                          </button>
                        )}
                      </td>
                    </tr>
                    {editingId === r.cert_id && editingRow && (
                      <tr>
                        <td colSpan={isSelfHired ? 8 : 7}>
                          <AppointmentLetterForm
                            row={editingRow}
                            showSelfHiredFields={isSelfHired}
                            onChange={setEditingRow}
                            onSave={() => handleSaveLetter(editingRow)}
                            onCancel={() => { setEditingId(null); setEditingRow(null); }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {letterRows.length === 0 && (
                <tr>
                  <td colSpan={isSelfHired ? 8 : 7} style={{ ...tdStyle, color: 'var(--sub)', textAlign: 'center' }}>目前沒有符合條件的教師</td>
                </tr>
              )}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 6 }}>灰色的起迄日期是預設值（尚未自訂）；列印會直接使用。</p>
        </div>
      )}
    </div>
  );
}

function AppointmentLetterForm({
  row, showSelfHiredFields, onChange, onSave, onCancel,
}: {
  row: MergedAppointmentRow;
  showSelfHiredFields: boolean;
  onChange: (r: MergedAppointmentRow) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<MergedAppointmentRow>) => onChange({ ...row, ...patch });
  return (
    <div style={{ border: '1px solid var(--line-strong)', borderRadius: 6, padding: 12, marginBottom: 12, background: 'var(--primary-soft)' }}>
      <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 8 }}>
        {row.name}（{row.title ?? '—'}／{row.gender ?? '—'}{row.resigned ? '／已離職' : ''}）——姓名/職位/性別/離職狀態要修改請到「歷年教師資料」分頁，這裡只能編輯下面的聘書專屬欄位。
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        <label>序號<input style={inputStyle} type="number" value={row.seq_no ?? ''} onChange={(e) => set({ seq_no: e.target.value ? Number(e.target.value) : null })} /></label>
        <label>聘期<input style={inputStyle} type="number" value={row.term_no ?? ''} onChange={(e) => set({ term_no: e.target.value ? Number(e.target.value) : null })} /></label>
        <label>起<input style={inputStyle} type="date" value={row.start_date ?? ''} onChange={(e) => set({ start_date: e.target.value || null })} /></label>
        <label>迄<input style={inputStyle} type="date" value={row.end_date ?? ''} onChange={(e) => set({ end_date: e.target.value || null })} /></label>
        {showSelfHiredFields && (
          <label>發聘時間<input style={inputStyle} type="date" value={row.issued_date ?? ''} onChange={(e) => set({ issued_date: e.target.value || null })} /></label>
        )}
        <label style={{ gridColumn: '1 / -1' }}>備註<input style={inputStyle} value={row.note ?? ''} onChange={(e) => set({ note: e.target.value || null })} /></label>
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" onClick={onSave} style={{ padding: '5px 14px', fontSize: 12, marginRight: 8, cursor: 'pointer' }}>儲存</button>
        <button type="button" onClick={onCancel} style={{ padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}>取消</button>
      </div>
    </div>
  );
}

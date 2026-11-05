'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabaseClient';
import { CompEvent } from '@/lib/competitionScoring';
import { Section, authFetch, btn, btnDanger, btnPrimary, errText, hint, td, th, useFlash } from './ui';

type Link = { token: string; enabled: boolean; path: string; showScore: boolean };
type Preview = { totalRows: number; newRows: number; skippedDuplicates: number; errors: { row: number; message: string }[] };

export default function PublicTab({ event }: { event: CompEvent }) {
  const flash = useFlash();
  const [link, setLink] = useState<Link | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ title: '', body: '' });

  const [linkErr, setLinkErr] = useState('');
  const loadLink = useCallback(async () => {
    setLinkErr('');
    try {
      const res = await authFetch(`/api/competitions/${event.id}/public-link`);
      if (res.ok) setLink(await res.json());
      else setLinkErr((await res.json().catch(() => ({}))).error ?? `讀取失敗（${res.status}）`);
    } catch {
      setLinkErr('網路錯誤，無法讀取公開頁設定');
    }
  }, [event.id]);
  useEffect(() => { loadLink(); }, [loadLink]);

  async function act(action: string, value?: boolean) {
    if (action === 'rotate' && !confirm('換新代碼後，舊的 QR 碼會立刻失效，公開頁也會先關閉。確定嗎？')) return;
    const res = await authFetch(`/api/competitions/${event.id}/public-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, value }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return flash.err(j.error ?? '失敗');
    setLink(j);
    flash.ok(action === 'enable' ? '公開頁已開啟' : action === 'disable' ? '公開頁已關閉' : action === 'rotate' ? '已換新代碼，請重新開啟並重印 QR 碼' : '已更新');
  }

  const url = link && typeof window !== 'undefined' ? `${window.location.origin}${link.path}` : '';
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!url) { setQr(''); return; }
    // 容錯等級 M、留白 2 格；解析度夠高，印在海報上也掃得到
    QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 640 }).then(setQr).catch(() => setQr(''));
  }, [url]);
  function downloadQr() {
    const a = document.createElement('a');
    a.href = qr; a.download = `${event.title}-成績QR碼.png`; a.click();
  }
  function printQr() {
    const w = window.open('', '_blank');
    if (!w) return flash.err('瀏覽器擋住了彈出視窗，請允許後再試');
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    w.document.write(`<!doctype html><title>成績QR碼</title><body style="text-align:center;font-family:'標楷體',serif;margin:40px">
      <h1 style="font-size:32px">${esc(event.title)}</h1><h2 style="font-size:24px;font-weight:normal">掃描 QR 碼查詢成績</h2>
      <img src="${qr}" style="width:420px;height:420px"><p style="font-size:14px;color:#555;word-break:break-all">${esc(url)}</p>
      <script>window.onload=function(){window.print()}<\/script></body>`);
    w.document.close();
  }

  async function downloadTemplate() {
    const res = await authFetch(`/api/competitions/${event.id}/import`);
    if (!res.ok) return flash.err('下載失敗');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = '外校名單匯入範本.xlsx';
    a.click(); URL.revokeObjectURL(a.href);
  }
  async function upload(commit: boolean) {
    if (!file) return flash.err('請先選擇 Excel 檔');
    setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    const res = await authFetch(`/api/competitions/${event.id}/import${commit ? '?commit=1' : ''}`, { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (j.totalRows !== undefined) setPreview(j);
    if (!res.ok) return flash.err(j.error ?? '匯入失敗');
    if (commit) { flash.ok(`已匯入 ${j.inserted} 位外部選手`); setFile(null); setPreview(null); }
    else flash.ok(`檢查完成：可新增 ${j.newRows} 筆、重複略過 ${j.skippedDuplicates} 筆、錯誤 ${j.errors.length} 筆`);
  }
  async function postNotice() {
    if (!notice.title.trim()) return flash.err('請填公告標題');
    const { error } = await supabase.from('comp_notices').insert({ event_id: event.id, kind: 'info', title: notice.title.trim(), body: notice.body.trim() || null });
    if (error) return flash.err(errText(error));
    flash.ok('公告已發出'); setNotice({ title: '', body: '' });
  }

  return (
    <div>
      {flash.node}
      <Section title="外校／家長查成績（QR 碼公開頁）">
        <p style={{ ...hint, marginBottom: 10 }}>外校與家長不需要登入，掃 QR 碼就能看「已公布」的成績與修正公告。預設只顯示姓名、學校、名次與獎項，不顯示學號與未公布的項目。</p>
        {!link ? (
          linkErr ? (
            <div style={{ fontSize: 13, color: '#A32D2D' }}>
              {linkErr} <button onClick={loadLink} style={{ ...btn, marginLeft: 8 }}>重試</button>
            </div>
          ) : <p style={hint}>載入中…</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 13 }}>狀態：<b style={{ color: link.enabled ? '#2d6a2d' : '#8a5a00' }}>{link.enabled ? '已開啟' : '已關閉'}</b></span>
              {link.enabled ? <button onClick={() => act('disable')} style={btn}>關閉公開頁</button> : <button onClick={() => act('enable')} style={btnPrimary}>開啟公開頁</button>}
              <button onClick={() => act('rotate')} style={btnDanger}>換新代碼（QR 外流時用）</button>
            </div>
            <div style={{ fontSize: 12, wordBreak: 'break-all', background: '#f7f7f7', padding: 8, borderRadius: 6 }}>{url}</div>
            <button onClick={() => navigator.clipboard?.writeText(url).then(() => flash.ok('已複製連結'))} style={{ ...btn, marginTop: 6 }}>複製連結</button>
            <label style={{ fontSize: 13, display: 'block', marginTop: 12 }}>
              <input type="checkbox" checked={link.showScore} onChange={(e) => act('show_score', e.target.checked)} /> 公開頁也顯示分數（預設只顯示名次與獎項）
            </label>
            {link.enabled ? (
              qr && (
                <div style={{ marginTop: 14, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <img src={qr} alt="成績查詢 QR 碼" width={180} height={180} style={{ border: '1px solid #eee' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button onClick={downloadQr} style={btn}>下載 QR 碼圖片</button>
                    <button onClick={printQr} style={btn}>列印海報</button>
                    <a href={link.path} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#1f4e79' }}>開啟公開頁預覽 ↗</a>
                  </div>
                </div>
              )
            ) : <p style={{ ...hint, marginTop: 10 }}>開啟公開頁後才會產生 QR 碼。</p>}
            <p style={{ ...hint, marginTop: 8 }}>QR 碼只有在公開頁「已開啟」時掃得到內容；換新代碼後舊的 QR 碼會作廢，海報要重印。</p>
          </>
        )}
      </Section>

      <Section title="匯入外校／外部選手名單">
        <p style={{ ...hint, marginBottom: 10 }}>外校選手不登入系統，由承辦人用 Excel 建檔留紀錄。填寫「項目代碼」即可（代碼在範本的「項目對照」工作表）。先檢查、確認無誤再正式匯入；只要有一列錯誤，整批都不會寫入。</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={downloadTemplate} style={btn}>下載範本</button>
          <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} aria-label="Excel 檔案" />
          <button onClick={() => upload(false)} disabled={busy || !file} style={btn}>檢查</button>
          <button onClick={() => upload(true)} disabled={busy || !file || !preview || preview.errors.length > 0 || preview.newRows === 0} style={btnPrimary}>正式匯入</button>
        </div>
        {preview && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            共 {preview.totalRows} 列；可新增 <b>{preview.newRows}</b>、重複略過 {preview.skippedDuplicates}、錯誤 <b style={{ color: preview.errors.length ? '#A32D2D' : undefined }}>{preview.errors.length}</b>
            {preview.errors.length > 0 && (
              <table style={{ borderCollapse: 'collapse', marginTop: 6 }}>
                <thead><tr><th style={th}>列</th><th style={th}>問題</th></tr></thead>
                <tbody>{preview.errors.slice(0, 50).map((e, i) => <tr key={i}><td style={td}>{e.row}</td><td style={td}>{e.message}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )}
      </Section>

      <Section title="發佈一般公告">
        <p style={{ ...hint, marginBottom: 8 }}>例如場地異動、時間調整。會顯示在公開頁的公告區。成績修正公告不用在這裡發，修正成績時系統會自動產生。</p>
        <input placeholder="標題" value={notice.title} onChange={(e) => setNotice({ ...notice, title: e.target.value })} style={{ width: '100%', padding: 6, boxSizing: 'border-box', marginBottom: 6 }} />
        <textarea placeholder="內容（選填）" rows={3} value={notice.body} onChange={(e) => setNotice({ ...notice, body: e.target.value })} style={{ width: '100%', padding: 6, boxSizing: 'border-box' }} />
        <button onClick={postNotice} style={{ ...btnPrimary, marginTop: 6 }}>發出公告</button>
      </Section>
    </div>
  );
}

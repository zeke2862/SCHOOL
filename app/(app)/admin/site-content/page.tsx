'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase, getCurrentAppUser } from '@/lib/supabaseClient';
import { HUBS } from '@/lib/permissions';
import {
  getSiteContentMap,
  saveSiteContentMap,
  getSiteSetting,
  saveSiteSetting,
  SITE_CONTENT_DEFAULTS,
  EXTRA_BUTTONS,
  hubLabelKey,
  hubDescKey,
  tabLabelKey,
  tabHintKey,
  extraLabelKey,
} from '@/lib/siteContent';

// 這幾個 key 對應到畫面上顯示的中文標籤，方便系統管理員S知道自己在改的是哪一段文字，
// 不用去記 key 字串本身代表什麼。
const CONTENT_LABELS: Record<string, string> = {
  'page_hint.scores_entry': '成績登錄頁：批次上傳說明',
  'page_hint.attendance_mobile_legend': '出缺勤登錄頁：顏色圖例收合標題',
  'page_hint.attendance_subject_view': '任課班級出席查詢頁：說明文字',
};

// 一個可編輯的文字欄位：顯示目前的字，改過會標示並可一鍵還原成預設
function TextField(props: { label: string; k: string; values: Record<string, string>; setValues: (f: (p: Record<string, string>) => Record<string, string>) => void; multiline?: boolean; placeholder?: string }) {
  const { label, k, values, setValues, multiline, placeholder } = props;
  const def = SITE_CONTENT_DEFAULTS[k] ?? '';
  const val = values[k] ?? def;
  const changed = val !== def;
  const common = {
    value: val,
    placeholder,
    onChange: (e: any) => setValues((prev) => ({ ...prev, [k]: e.target.value })),
    style: { width: '100%', padding: 8, boxSizing: 'border-box' as const, fontSize: 14, background: changed ? '#FFF8E1' : '#fff' },
  };
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#777', marginBottom: 2 }}>
        <span>{label}</span>
        {changed && (
          <button type="button" className="keep-size" onClick={() => setValues((prev) => ({ ...prev, [k]: def }))} style={{ fontSize: 11, background: 'none', border: 'none', color: '#2C6E9E', cursor: 'pointer', padding: 0, minHeight: 0 }}>
            還原預設{def ? `（${def.length > 14 ? def.slice(0, 14) + '…' : def}）` : ''}
          </button>
        )}
      </label>
      {multiline ? <textarea rows={2} {...common} /> : <input {...common} />}
    </div>
  );
}

export default function SiteContentAdminPage() {
  const [allowed, setAllowed] = useState<'checking' | 'yes' | 'no'>('checking');
  const [values, setValues] = useState<Record<string, string>>(SITE_CONTENT_DEFAULTS);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicStatus, setMusicStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      const appUser = await getCurrentAppUser();
      // 這頁是全站設定（不分部門），刻意只給系統管理員S用，跟部門管理員（A/B）能看到
      // 的其他分類設定頁不一樣範圍，所以這裡不是照 ADMIN_ROLES 三種都放行，是額外多檢查一層。
      if (!appUser || appUser.role !== 'system_admin_s') {
        setAllowed('no');
        return;
      }
      setAllowed('yes');
      const map = await getSiteContentMap();
      setValues(map);
      const url = await getSiteSetting('background_music_url');
      setMusicUrl(url);
    })();
  }, []);

  async function handleSaveContent() {
    setSaveStatus('saving');
    const error = await saveSiteContentMap(values);
    if (error) {
      setSaveStatus('error');
      return;
    }
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }

  async function handleUploadMusic(file: File) {
    setMusicStatus('uploading');
    const path = `background-music/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('site-assets').upload(path, file);
    if (uploadError) {
      setMusicStatus('error');
      alert('上傳失敗：' + uploadError.message);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from('site-assets').getPublicUrl(path);
    const saveError = await saveSiteSetting('background_music_url', publicUrlData.publicUrl);
    if (saveError) {
      setMusicStatus('error');
      alert(saveError);
      return;
    }
    setMusicUrl(publicUrlData.publicUrl);
    setMusicStatus('idle');
  }

  async function handleRemoveMusic() {
    const error = await saveSiteSetting('background_music_url', null);
    if (error) {
      alert(error);
      return;
    }
    setMusicUrl(null);
  }

  if (allowed === 'checking') {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
        <p style={{ fontSize: 13, color: '#999' }}>載入中…</p>
      </main>
    );
  }

  if (allowed === 'no') {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16, marginBottom: 4 }}>系統文字與背景音樂設定</h1>
        <p style={{ fontSize: 13, color: '#999' }}>此頁僅系統管理員可使用。</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>系統文字與背景音樂設定</h1>
      <p style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>
        這裡可以修改<b>首頁方形按鈕</b>、<b>各入口裡的功能按鈕</b>、<b>首頁「其他」按鈕</b>的文字，以及幾頁的說明文字。
        只有被改過的文字才會存起來，沒改過的永遠跟著系統最新的原文；想回到原本的字，按該欄的「還原預設」再儲存即可。
      </p>

      <h2 id="bgm" style={{ fontSize: 14, marginBottom: 8 }}>背景音樂</h2>
      {musicUrl ? (
        <div style={{ marginBottom: 8 }}>
          <audio controls src={musicUrl} style={{ width: '100%', marginBottom: 8 }} />
          <button onClick={handleRemoveMusic} style={{ padding: '4px 12px', fontSize: 12, color: '#A32D2D' }}>
            移除目前的背景音樂
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>目前尚未設定背景音樂。</p>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadMusic(file);
        }}
        style={{ fontSize: 12 }}
      />
      {musicStatus === 'uploading' && <p style={{ fontSize: 12, color: '#999' }}>上傳中…</p>}
      <p style={{ fontSize: 11, color: '#999', marginTop: 4, marginBottom: 20 }}>
        上傳後所有登入的人在畫面右上角都會看到播放鍵；瀏覽器規定不能自動播放有聲音的內容，
        每個人要自己按一次播放鍵才會開始播放（這不是本系統的限制，是 Chrome／Safari 的規定）。
      </p>

      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#F7F6F3', padding: '8px 0', marginBottom: 8 }}>
        <button
          onClick={handleSaveContent}
          disabled={saveStatus === 'saving'}
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#2C2C2A', color: '#fff', cursor: 'pointer' }}
        >
          {saveStatus === 'saving' ? '儲存中…' : '儲存所有文字修改'}
        </button>
        {saveStatus === 'saved' && <span style={{ fontSize: 12, color: '#3B6D11', marginLeft: 10 }}>已儲存，重新整理首頁即可看到</span>}
        {saveStatus === 'error' && <span style={{ fontSize: 12, color: '#A32D2D', marginLeft: 10 }}>儲存失敗，請確認資料庫已執行 sql/39site_content_settings_assets.sql</span>}
        <span style={{ fontSize: 11, color: '#999', marginLeft: 10 }}>黃底＝已改過；按「還原預設」會回到程式裡的原文</span>
      </div>

      <h2 id="home-tiles" style={{ fontSize: 16, margin: '16px 0 4px' }}>① 首頁的方形按鈕</h2>
      <p style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>首頁每一顆方形按鈕的名稱與說明。按鈕太小時說明會自動隱藏，只留名稱，所以名稱請盡量簡短。</p>
      <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 20, background: '#fff' }}>
        {HUBS.map((h) => (
          <div key={h.key} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px dashed #eee' }}>
            <TextField label={`入口名稱（${h.href}）`} k={hubLabelKey(h.key)} values={values} setValues={setValues} />
            <TextField label="說明" k={hubDescKey(h.key)} values={values} setValues={setValues} />
          </div>
        ))}
      </div>

      <h2 id="tab-buttons" style={{ fontSize: 16, margin: '16px 0 4px' }}>② 點進入口後的功能按鈕</h2>
      <p style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>點進某個入口（例如「學籍與學生」）後看到的每一顆功能按鈕；名稱也會出現在頁面上方「入口 › 功能」的位置列。小字說明可以留空。</p>
      {HUBS.map((h) => (
        <details key={h.key} style={{ border: '1px solid #eee', borderRadius: 8, padding: '8px 10px', marginBottom: 8, background: '#fff' }}>
          <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
            {values[hubLabelKey(h.key)] ?? h.label}（{h.tabs.length} 個功能）
          </summary>
          <div style={{ marginTop: 10 }}>
            {h.tabs.map((t) => (
              <div key={t.key} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px dashed #eee' }}>
                <TextField label={`功能名稱（${h.key} / ${t.key}）`} k={tabLabelKey(h.key, t.key)} values={values} setValues={setValues} />
                <TextField label="小字說明（選填）" k={tabHintKey(h.key, t.key)} values={values} setValues={setValues} />
              </div>
            ))}
          </div>
        </details>
      ))}

      <h2 id="extra-buttons" style={{ fontSize: 16, margin: '20px 0 4px' }}>③ 首頁最下面「其他」的按鈕</h2>
      <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 20, background: '#fff' }}>
        {EXTRA_BUTTONS.map((e) => (
          <TextField key={e.id} label={`${e.href}`} k={extraLabelKey(e.id)} values={values} setValues={setValues} />
        ))}
      </div>

      <h2 id="other-text" style={{ fontSize: 16, margin: '20px 0 8px' }}>④ 其他頁面的說明文字</h2>
      {Object.keys(CONTENT_LABELS).map((key) => (
        <TextField key={key} label={CONTENT_LABELS[key]} k={key} values={values} setValues={setValues} multiline />
      ))}

    </main>
  );
}

'use client';

import { useState } from 'react';
import TeacherAccountsPage from '@/app/(app)/admin/teacher-accounts/page';
import ClassAccountsPage from '@/app/(app)/admin/class-accounts/page';

// 系統管理「資料檢查」：把原本分開的「教師資料檢查／合併」「班級資料檢查／合併」放在同一個按鈕底下。
// 兩個檢查頁本身沒有改動（/admin/teacher-accounts、/admin/class-accounts 仍可直接開啟）。
// 平常不需要點進來；課表或名單批次匯入之後看一眼，或老師反映「登入後看不到班級」「同一班出現兩次」時再用。
const SECTIONS = [
  { key: 'teacher', label: '教師資料檢查／合併', hint: '老師登入後看不到班級、同一位老師出現兩筆' },
  { key: 'class', label: '班級資料檢查／合併', hint: '同一個班出現兩次、班級人數對不上' },
] as const;

export default function DataCheckPanel() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]['key']>('teacher');

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid #2C6E9E', fontSize: 13, cursor: 'pointer',
              background: section === s.key ? '#2C6E9E' : '#fff', color: section === s.key ? '#fff' : '#2C6E9E',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 12, color: '#666', margin: '0 0 12px' }}>{SECTIONS.find((s) => s.key === section)?.hint}</p>
      {section === 'teacher' ? <TeacherAccountsPage /> : <ClassAccountsPage />}
    </div>
  );
}

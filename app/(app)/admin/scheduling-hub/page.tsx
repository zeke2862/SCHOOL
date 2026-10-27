'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDepartmentPermissions } from '@/lib/useDepartmentPermissions';
import { hasDepartment } from '@/lib/departments';
import SchedulingPage from '../scheduling/page';
import SchoolTimetableAdminPage from '../school-timetable/page';
import SubstituteTeachingPage from '../substitute-teaching/page';
import ScheduleLookupPage from '../../schedule-lookup/page';
import ScheduleDuplicatesPanel from '@/components/scheduling/ScheduleDuplicatesPanel';
import TimetablePrint from '@/components/scheduling/TimetablePrint';

// ============================================================
// 排課與代課中心
// ------------------------------------------------------------
// 以前「排課系統」「學校課表」「代課安排」「共同科目時間鎖定」「課表查詢」是 5 張分開的首頁卡片，
// 而且彼此重疊（例如排課系統、學校課表都能上傳課表 Excel；代課要回頭看課表、查課表）。
// 現在全部集中在這一頁用分頁切換，每個分頁裡放的就是原本那一頁（功能、權限、送審規則完全沒改），
// 舊網址（/admin/scheduling 等）仍然可以直接打開，只是不再各自佔一張首頁卡片。
// ============================================================

type TabKey = 'tool' | 'timetable' | 'print' | 'substitute' | 'lookup' | 'cleanup';

const TABS: { key: TabKey; label: string; hint: string; devOnly?: boolean }[] = [
  { key: 'tool', label: '① 排課工具', hint: '自動排課、匯入／匯出排課 Excel、存檔到校務系統、歷史存檔' },
  { key: 'timetable', label: '② 本學期課表清單', hint: '只列本學期的課；有班級要更動，直接修改該節的科目與任課教師' },
  { key: 'print', label: '③ 列印課表', hint: '全校教師任課表、各教師課表、課表模板、各班課表、值日教師參考（無導師的班級不印）' },
  { key: 'substitute', label: '④ 請假與代課', hint: '代為輸入請假、安排代課老師、處理老師自己送出的請假' },
  { key: 'lookup', label: '⑤ 課表查詢', hint: '選教師或班級直接看整週課表' },
  { key: 'cleanup', label: '⑥ 課表資料整理', hint: '檢查並清掉任課教師設定的重複列（僅系統管理員S／開發人員）', devOnly: true },
];

function HubInner() {
  const perms = useDepartmentPermissions();
  const canDev = perms.isSystemAdmin || hasDepartment(perms.myDepartments, 'dev');
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab') as TabKey | null;
  const [tab, setTab] = useState<TabKey>('tool');

  useEffect(() => {
    if (requested && TABS.some((t) => t.key === requested)) setTab(requested);
  }, [requested]);

  const visibleTabs = TABS.filter((t) => !t.devOnly || canDev);
  const current = visibleTabs.find((t) => t.key === tab) ?? visibleTabs[0];

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '16px 12px' }}>
      <h1 style={{ fontSize: 16, margin: '0 12px 4px' }}>排課與代課中心</h1>
      <p style={{ fontSize: 12, color: '#999', margin: '0 12px 12px' }}>
        排課、課表、代課、時間鎖定、課表查詢都集中在這裡。課表相關的 Excel 上傳／下載請統一從「① 排課工具」或「② 學校課表」進行；
        全校所有資料的 Excel（含課表資料表）一鍵下載／上傳，請到「開發人員資料中心」。
      </p>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid #ddd', margin: '0 12px' }}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              background: 'none',
              border: 'none',
              borderBottom: current.key === t.key ? '2px solid #2C2C2A' : '2px solid transparent',
              color: current.key === t.key ? '#2C2C2A' : '#999',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 11, color: '#aaa', margin: '6px 12px 0' }}>{current.hint}</p>

      {current.key === 'tool' && <SchedulingPage />}
      {current.key === 'timetable' && <SchoolTimetableAdminPage />}
      {current.key === 'print' && <TimetablePrint />}
      {current.key === 'substitute' && <SubstituteTeachingPage />}
      {current.key === 'lookup' && <ScheduleLookupPage />}
      {current.key === 'cleanup' && canDev && <ScheduleDuplicatesPanel />}
    </div>
  );
}

export default function SchedulingHubPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24, fontSize: 13, color: '#999' }}>載入中…</p>}>
      <HubInner />
    </Suspense>
  );
}

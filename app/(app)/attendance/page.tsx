'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const TodayPage = dynamic(() => import('@/app/(app)/attendance/mobile/page'), { loading: TabLoading });
const WeekPage = dynamic(() => import('@/app/(app)/attendance/weekly/page'), { loading: TabLoading });
const RecordsPage = dynamic(() => import('@/app/(app)/attendance/report/page'), { loading: TabLoading });
const SubjectPage = dynamic(() => import('@/app/(app)/attendance/subject-view/page'), { loading: TabLoading });
const SchoolPage = dynamic(() => import('@/app/(app)/reports/school-attendance/page'), { loading: TabLoading });
const AlertSettingsPage = dynamic(() => import('@/app/(app)/admin/attendance-alert-settings/page'), { loading: TabLoading });

// 出缺席：當天／一週／紀錄查詢／任課班級出席查詢／全校總覽（＋訓導主管才看得到的示警門檻設定）
export default function AttendanceHubPage() {
  return (
    <HubShell
      hubKey="attendance"
      renderers={{
        today: () => <TodayPage />,
        week: () => <WeekPage />,
        records: () => <RecordsPage />,
        subject: () => <SubjectPage />,
        school: () => <SchoolPage />,
        alert: () => <AlertSettingsPage />,
      }}
    />
  );
}

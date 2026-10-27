'use client';

import HubShell from '@/components/hub/HubShell';
import TodayPage from '@/app/(app)/attendance/mobile/page';
import WeekPage from '@/app/(app)/attendance/weekly/page';
import RecordsPage from '@/app/(app)/attendance/report/page';
import SubjectPage from '@/app/(app)/attendance/subject-view/page';
import SchoolPage from '@/app/(app)/reports/school-attendance/page';
import AlertSettingsPage from '@/app/(app)/admin/attendance-alert-settings/page';

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

'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const AttendanceRequestsPage = dynamic(() => import('@/app/(app)/reports/attendance-unlock-requests/page'), { loading: TabLoading });
const ScoreCorrectionPage = dynamic(() => import('@/app/(app)/reports/score-correction-requests/page'), { loading: TabLoading });
const ProfileRequestsPage = dynamic(() => import('@/app/(app)/reports/profile-requests/page'), { loading: TabLoading });
const PendingChangesPage = dynamic(() => import('@/app/(app)/admin/pending-changes/page'), { loading: TabLoading });
const AuditLogsPage = dynamic(() => import('@/app/(app)/admin/audit-logs/page'), { loading: TabLoading });
const ChangeAuditPanel = dynamic(() => import('@/components/ChangeAuditPanel'), { loading: TabLoading });
const PortalRegistrationReview = dynamic(() => import('@/components/portal/PortalRegistrationReview'), { loading: TabLoading });
const StudentLeaveReview = dynamic(() => import('@/components/portal/StudentLeaveReview'), { loading: TabLoading });
const StatusRequestReview = dynamic(() => import('@/components/portal/StatusRequestReview'), { loading: TabLoading });

// 審核中心：每一類審核各一個分頁，依登入者身分只顯示自己有份的；各部門只看得到自己部門的案件（由資料庫權限把關）
export default function ReviewHubPage() {
  return (
    <HubShell
      hubKey="review"
      renderers={{
        attendance: () => <AttendanceRequestsPage />,
        score: () => <ScoreCorrectionPage />,
        profile: () => <ProfileRequestsPage />,
        'portal-requests': () => <PortalRegistrationReview />,
        'student-leave': () => <StudentLeaveReview />,
        'status-requests': () => <StatusRequestReview />,
        pending: () => <PendingChangesPage />,
        audit: () => <AuditLogsPage />,
        changes: () => <ChangeAuditPanel />,
      }}
    />
  );
}

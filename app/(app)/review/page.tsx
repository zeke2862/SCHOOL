'use client';

import HubShell from '@/components/hub/HubShell';
import AttendanceRequestsPage from '@/app/(app)/reports/attendance-unlock-requests/page';
import ScoreCorrectionPage from '@/app/(app)/reports/score-correction-requests/page';
import ProfileRequestsPage from '@/app/(app)/reports/profile-requests/page';
import PendingChangesPage from '@/app/(app)/admin/pending-changes/page';
import AuditLogsPage from '@/app/(app)/admin/audit-logs/page';
import ChangeAuditPanel from '@/components/ChangeAuditPanel';
import PortalRegistrationReview from '@/components/portal/PortalRegistrationReview';

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
        pending: () => <PendingChangesPage />,
        audit: () => <AuditLogsPage />,
        changes: () => <ChangeAuditPanel />,
      }}
    />
  );
}

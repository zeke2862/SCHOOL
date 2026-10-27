'use client';

import HubShell from '@/components/hub/HubShell';
import StudentsSearchTab from '@/components/admin-tabs/StudentsSearchTab';
import StudentsNewTab from '@/components/admin-tabs/StudentsNewTab';
import StudentsImportTab from '@/components/admin-tabs/StudentsImportTab';
import StudentsStatusChangeTab from '@/components/admin-tabs/StudentsStatusChangeTab';
import StudentsTransferTab from '@/components/admin-tabs/StudentsTransferTab';
import StudentsPromotionTab from '@/components/admin-tabs/StudentsPromotionTab';
import GradeProgressionTab from '@/components/admin-tabs/GradeProgressionTab';
import DocumentsPage from '@/app/(app)/admin/students/documents/page';
import PortalAccountsPage from '@/app/(app)/admin/students/portal-accounts/page';

// 學籍與學生入口：分頁可見性由 lib/permissions.ts 的 HUBS.registrar 依身分決定。
export default function RegistrarHubPage() {
  return (
    <HubShell
      hubKey="registrar"
      renderers={{
        search: () => <StudentsSearchTab />,
        new: () => <StudentsNewTab />,
        import: () => <StudentsImportTab />,
        'status-change': () => <StudentsStatusChangeTab />,
        transfer: () => <StudentsTransferTab />,
        promotion: () => <StudentsPromotionTab />,
        'grade-progression': () => <GradeProgressionTab />,
        documents: () => <DocumentsPage />,
        'portal-accounts': () => <PortalAccountsPage />,
      }}
    />
  );
}

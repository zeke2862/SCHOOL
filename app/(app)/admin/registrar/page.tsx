'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const StudentsSearchTab = dynamic(() => import('@/components/admin-tabs/StudentsSearchTab'), { loading: TabLoading });
const StudentPhotosTab = dynamic(() => import('@/components/admin-tabs/StudentPhotosTab'), { loading: TabLoading });
const StudentsNewTab = dynamic(() => import('@/components/admin-tabs/StudentsNewTab'), { loading: TabLoading });
const StudentsImportTab = dynamic(() => import('@/components/admin-tabs/StudentsImportTab'), { loading: TabLoading });
const StudentsStatusChangeTab = dynamic(() => import('@/components/admin-tabs/StudentsStatusChangeTab'), { loading: TabLoading });
const StudentsTransferTab = dynamic(() => import('@/components/admin-tabs/StudentsTransferTab'), { loading: TabLoading });
const StudentsPromotionTab = dynamic(() => import('@/components/admin-tabs/StudentsPromotionTab'), { loading: TabLoading });
const GradeProgressionTab = dynamic(() => import('@/components/admin-tabs/GradeProgressionTab'), { loading: TabLoading });
const DocumentsPage = dynamic(() => import('@/app/(app)/admin/students/documents/page'), { loading: TabLoading });
const PortalAccountsPage = dynamic(() => import('@/app/(app)/admin/students/portal-accounts/page'), { loading: TabLoading });

// 學籍與學生入口：分頁可見性由 lib/permissions.ts 的 HUBS.registrar 依身分決定。
export default function RegistrarHubPage() {
  return (
    <HubShell
      hubKey="registrar"
      renderers={{
        search: () => <StudentsSearchTab />,
        photos: () => <StudentPhotosTab />,
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

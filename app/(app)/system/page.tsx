'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const AccountsPage = dynamic(() => import('@/app/(app)/admin/accounts/page'), { loading: TabLoading });
const TempStaffPanel = dynamic(() => import('@/components/delegation/TempStaffPanel'), { loading: TabLoading });
const DevToolsPage = dynamic(() => import('@/app/(app)/admin/dev-tools/page'), { loading: TabLoading });
const DataCheckPanel = dynamic(() => import('@/components/system/DataCheckPanel'), { loading: TabLoading });
const AcademicTermsPage = dynamic(() => import('@/app/(app)/admin/academic-terms/page'), { loading: TabLoading });
const TeacherDeskPage = dynamic(() => import('@/app/(app)/admin/teacher-desk/page'), { loading: TabLoading });
const BulletinPage = dynamic(() => import('@/app/(app)/admin/bulletin/page'), { loading: TabLoading });
const SiteContentPage = dynamic(() => import('@/app/(app)/admin/site-content/page'), { loading: TabLoading });
const EmailSettingsPage = dynamic(() => import('@/app/(app)/admin/email-settings/page'), { loading: TabLoading });

export default function SystemHubPage() {
  return (
    <HubShell
      hubKey="system"
      renderers={{
        accounts: () => <AccountsPage />,
        'temp-staff': () => <TempStaffPanel />,
        'dev-tools': () => <DevToolsPage />,
        'data-check': () => <DataCheckPanel />,
        'academic-terms': () => <AcademicTermsPage />,
        'teacher-desk': () => <TeacherDeskPage />,
        bulletin: () => <BulletinPage />,
        'site-content': () => <SiteContentPage />,
        'email-settings': () => <EmailSettingsPage />,
      }}
    />
  );
}

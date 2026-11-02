'use client';

import HubShell from '@/components/hub/HubShell';
import AccountsPage from '@/app/(app)/admin/accounts/page';
import TempStaffPanel from '@/components/delegation/TempStaffPanel';
import DevToolsPage from '@/app/(app)/admin/dev-tools/page';
import DataCheckPanel from '@/components/system/DataCheckPanel';
import AcademicTermsPage from '@/app/(app)/admin/academic-terms/page';
import TeacherDeskPage from '@/app/(app)/admin/teacher-desk/page';
import BulletinPage from '@/app/(app)/admin/bulletin/page';
import SiteContentPage from '@/app/(app)/admin/site-content/page';
import EmailSettingsPage from '@/app/(app)/admin/email-settings/page';

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

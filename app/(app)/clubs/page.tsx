'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const ClubRosterPage = dynamic(() => import('@/app/(app)/clubs/roster/page'), { loading: TabLoading });
const ClubGradingPage = dynamic(() => import('@/app/(app)/clubs/grading/page'), { loading: TabLoading });
const AdminClubsPage = dynamic(() => import('@/app/(app)/admin/clubs/page'), { loading: TabLoading });
const ClubProxyPage = dynamic(() => import('@/app/(app)/clubs/proxy/page'), { loading: TabLoading });

export default function ClubsHubPage() {
  return (
    <HubShell
      hubKey="clubs"
      renderers={{
        roster: () => <ClubRosterPage />,
        grading: () => <ClubGradingPage />,
        proxy: () => <ClubProxyPage />,
        admin: () => <AdminClubsPage />,
      }}
    />
  );
}

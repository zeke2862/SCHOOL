'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const RewardsPage = dynamic(() => import('@/app/(app)/discipline/rewards/page'), { loading: TabLoading });
const RewardsHistoryPage = dynamic(() => import('@/app/(app)/discipline/rewards/history/page'), { loading: TabLoading });

export default function DisciplineHubPage() {
  return (
    <HubShell
      hubKey="rewards"
      renderers={{
        register: () => <RewardsPage />,
        history: () => <RewardsHistoryPage />,
      }}
    />
  );
}

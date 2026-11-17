'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const MyClockPage = dynamic(() => import('@/app/(app)/staff-clock/page'), { loading: TabLoading });
const AdminClockPage = dynamic(() => import('@/app/(app)/admin/staff-clock/page'), { loading: TabLoading });

export default function ClockHubPage() {
  return (
    <HubShell
      hubKey="clock"
      renderers={{
        mine: () => <MyClockPage />,
        manage: () => <AdminClockPage />,
      }}
    />
  );
}

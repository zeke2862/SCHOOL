'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const ExamRostersPage = dynamic(() => import('@/app/(app)/exam-rosters/page'), { loading: TabLoading });
const ExamSeatingPage = dynamic(() => import('@/app/(app)/admin/exam-seating/page'), { loading: TabLoading });

export default function ExamHubPage() {
  return (
    <HubShell
      hubKey="exam"
      renderers={{
        rosters: () => <ExamRostersPage />,
        seating: () => <ExamSeatingPage />,
      }}
    />
  );
}

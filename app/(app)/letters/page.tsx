'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const TeacherLettersSection = dynamic(() => import('@/components/dev-tools/TeacherLettersSection'), { loading: TabLoading });

// 【行政管理】→「聘書」：只有教務處、管理員A、系統管理員S看得到
export default function LettersHubPage() {
  return <HubShell hubKey="letters" renderers={{ main: () => <TeacherLettersSection /> }} />;
}

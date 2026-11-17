'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const ClassRollBook = dynamic(() => import('@/components/rollbook/ClassRollBook'), { loading: TabLoading });
const CoverEditor = dynamic(() => import('@/components/rollbook/CoverEditor'), { loading: TabLoading });

// 班級點名冊：本校教職員都能挑班級、列印「一週」或「整學期」的空白點名冊
export default function RollBookHubPage() {
  return <HubShell hubKey="rollbook" renderers={{ print: () => <ClassRollBook />, cover: () => <CoverEditor /> }} />;
}

'use client';

import HubShell from '@/components/hub/HubShell';
import TeacherLettersSection from '@/components/dev-tools/TeacherLettersSection';

// 【行政管理】→「聘書」：只有教務處、管理員A、系統管理員S看得到
export default function LettersHubPage() {
  return <HubShell hubKey="letters" renderers={{ main: () => <TeacherLettersSection /> }} />;
}

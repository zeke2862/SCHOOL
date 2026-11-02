'use client';

import HubShell from '@/components/hub/HubShell';
import ClassRollBook from '@/components/rollbook/ClassRollBook';
import CoverEditor from '@/components/rollbook/CoverEditor';

// 班級點名冊：本校教職員都能挑班級、列印「一週」或「整學期」的空白點名冊
export default function RollBookHubPage() {
  return <HubShell hubKey="rollbook" renderers={{ print: () => <ClassRollBook />, cover: () => <CoverEditor /> }} />;
}

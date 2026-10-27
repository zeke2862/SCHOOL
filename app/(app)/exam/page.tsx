'use client';

import HubShell from '@/components/hub/HubShell';
import ExamRostersPage from '@/app/(app)/exam-rosters/page';
import ExamSeatingPage from '@/app/(app)/admin/exam-seating/page';

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

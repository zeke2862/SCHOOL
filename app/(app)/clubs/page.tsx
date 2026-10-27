'use client';

import HubShell from '@/components/hub/HubShell';
import ClubRosterPage from '@/app/(app)/clubs/roster/page';
import ClubGradingPage from '@/app/(app)/clubs/grading/page';
import AdminClubsPage from '@/app/(app)/admin/clubs/page';

export default function ClubsHubPage() {
  return (
    <HubShell
      hubKey="clubs"
      renderers={{
        roster: () => <ClubRosterPage />,
        grading: () => <ClubGradingPage />,
        admin: () => <AdminClubsPage />,
      }}
    />
  );
}

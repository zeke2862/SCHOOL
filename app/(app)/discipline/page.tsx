'use client';

import HubShell from '@/components/hub/HubShell';
import RewardsPage from '@/app/(app)/discipline/rewards/page';
import RewardsHistoryPage from '@/app/(app)/discipline/rewards/history/page';

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

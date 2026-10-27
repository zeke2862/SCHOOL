'use client';

import HubShell from '@/components/hub/HubShell';
import MyClockPage from '@/app/(app)/staff-clock/page';
import AdminClockPage from '@/app/(app)/admin/staff-clock/page';

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

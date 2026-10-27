'use client';

import HubShell from '@/components/hub/HubShell';
import MaintenancePage from '@/app/(app)/admin/general/maintenance/page';
import LibraryPage from '@/app/(app)/admin/general/library/page';
import UniformsPage from '@/app/(app)/admin/general/uniforms/page';
import NotebooksPage from '@/app/(app)/admin/general/notebooks/page';
import UtilitiesPage from '@/app/(app)/admin/general/utilities/page';

export default function GeneralHubPage() {
  return (
    <HubShell
      hubKey="general"
      renderers={{
        maintenance: () => <MaintenancePage />,
        library: () => <LibraryPage />,
        uniforms: () => <UniformsPage />,
        notebooks: () => <NotebooksPage />,
        utilities: () => <UtilitiesPage />,
      }}
    />
  );
}

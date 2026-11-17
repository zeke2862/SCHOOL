'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const MaintenancePage = dynamic(() => import('@/app/(app)/admin/general/maintenance/page'), { loading: TabLoading });
const LibraryPage = dynamic(() => import('@/app/(app)/admin/general/library/page'), { loading: TabLoading });
const UniformsPage = dynamic(() => import('@/app/(app)/admin/general/uniforms/page'), { loading: TabLoading });
const NotebooksPage = dynamic(() => import('@/app/(app)/admin/general/notebooks/page'), { loading: TabLoading });
const UtilitiesPage = dynamic(() => import('@/app/(app)/admin/general/utilities/page'), { loading: TabLoading });

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

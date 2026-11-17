'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const SeatingChartTab = dynamic(() => import('@/components/admin-tabs/SeatingChartTab'), { loading: TabLoading });

// 班級座位表：首頁「教學作業」區的獨立入口（跟出缺席、成績同一層）。
// 只有一個功能，HubShell 會直接顯示內容，不多一層選單。
export default function SeatingHubPage() {
  return <HubShell hubKey="seating" renderers={{ chart: () => <SeatingChartTab /> }} />;
}

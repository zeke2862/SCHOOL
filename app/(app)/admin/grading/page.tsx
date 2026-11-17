'use client';

import HubShell from '@/components/hub/HubShell';
import dynamic from 'next/dynamic';
import TabLoading from '@/components/hub/TabLoading';

// 各功能分頁改成「點進去才下載」：進入口時只載入口本身，不會一次把所有分頁的程式都抓下來
const CurriculumSettingsTab = dynamic(() => import('@/components/admin-tabs/CurriculumSettingsTab'), { loading: TabLoading });
const GradingRulesTab = dynamic(() => import('@/components/admin-tabs/GradingRulesTab'), { loading: TabLoading });
const OrphanSubjectsPanel = dynamic(() => import('@/components/admin-tabs/OrphanSubjectsPanel'), { loading: TabLoading });
const ScoresEntryTab = dynamic(() => import('@/components/admin-tabs/ScoresEntryTab'), { loading: TabLoading });
const ConductScoresTab = dynamic(() => import('@/components/admin-tabs/ConductScoresTab'), { loading: TabLoading });
const ReportCardStyleTab = dynamic(() => import('@/components/admin-tabs/ReportCardStyleTab'), { loading: TabLoading });
const ClassSummaryTab = dynamic(() => import('@/components/admin-tabs/ClassSummaryTab'), { loading: TabLoading });
const ClassResultsTab = dynamic(() => import('@/components/admin-tabs/ClassResultsTab'), { loading: TabLoading });
const SchoolRankingsTab = dynamic(() => import('@/components/admin-tabs/SchoolRankingsTab'), { loading: TabLoading });
const HistoryTab = dynamic(() => import('@/components/admin-tabs/HistoryTab'), { loading: TabLoading });
const BatchReportCardTab = dynamic(() => import('@/components/admin-tabs/BatchReportCardTab'), { loading: TabLoading });
const ReportCardMergeTemplateTab = dynamic(() => import('@/components/admin-tabs/ReportCardMergeTemplateTab'), { loading: TabLoading });
const ReportCardXlsxTemplateTab = dynamic(() => import('@/components/admin-tabs/ReportCardXlsxTemplateTab'), { loading: TabLoading });
const ScoreSubmissionWindowsPage = dynamic(() => import('@/app/(app)/admin/score-submission-windows/page'), { loading: TabLoading });

// 成績入口：哪些分頁看得到，由 lib/permissions.ts 的 HUBS.grading 依身分決定
// （任課教師只有「學生成績登錄」「全校排行榜」「歷年成績查詢」；導師再多操行成績、班級總表、班級成績結果與排名；
//   教務處負責人還能看到設定、批次列印與各種範本）。沒權限的分頁根本不會出現。
export default function GradingHubPage() {
  return (
    <HubShell
      hubKey="grading"
      renderers={{
        entry: () => <ScoresEntryTab />,
        'school-rankings': () => <SchoolRankingsTab />,
        conduct: () => <ConductScoresTab />,
        'class-summary': () => <ClassSummaryTab />,
        'class-results': () => <ClassResultsTab />,
        history: () => <HistoryTab />,
        settings: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <section>
              <h2 style={{ fontSize: 14, color: 'var(--sub)', marginBottom: 8 }}>科目與比重設定</h2>
              <CurriculumSettingsTab />
            </section>
            <section style={{ borderTop: '1px solid var(--line)', paddingTop: 24 }}>
              <h2 style={{ fontSize: 14, color: 'var(--sub)', marginBottom: 8 }}>整體佔比與加扣分規則</h2>
              <GradingRulesTab />
            </section>
            <section style={{ borderTop: '1px solid var(--line)', paddingTop: 24 }}>
              <h2 style={{ fontSize: 14, color: 'var(--sub)', marginBottom: 8 }}>殘留科目清理（成績表有分數、科目設定裡卻沒有的科目）</h2>
              <OrphanSubjectsPanel />
            </section>
          </div>
        ),
        windows: () => <ScoreSubmissionWindowsPage />,
        'batch-print': () => <BatchReportCardTab />,
        'report-card-style': () => <ReportCardStyleTab />,
        'report-card-merge-template': () => <ReportCardMergeTemplateTab />,
        'report-card-xlsx-template': () => <ReportCardXlsxTemplateTab />,
      }}
    />
  );
}

'use client';

import HubShell from '@/components/hub/HubShell';
import CurriculumSettingsTab from '@/components/admin-tabs/CurriculumSettingsTab';
import GradingRulesTab from '@/components/admin-tabs/GradingRulesTab';
import OrphanSubjectsPanel from '@/components/admin-tabs/OrphanSubjectsPanel';
import ScoresEntryTab from '@/components/admin-tabs/ScoresEntryTab';
import ConductScoresTab from '@/components/admin-tabs/ConductScoresTab';
import ReportCardStyleTab from '@/components/admin-tabs/ReportCardStyleTab';
import ClassSummaryTab from '@/components/admin-tabs/ClassSummaryTab';
import ClassResultsTab from '@/components/admin-tabs/ClassResultsTab';
import SchoolRankingsTab from '@/components/admin-tabs/SchoolRankingsTab';
import HistoryTab from '@/components/admin-tabs/HistoryTab';
import BatchReportCardTab from '@/components/admin-tabs/BatchReportCardTab';
import ReportCardMergeTemplateTab from '@/components/admin-tabs/ReportCardMergeTemplateTab';
import ReportCardXlsxTemplateTab from '@/components/admin-tabs/ReportCardXlsxTemplateTab';
import ScoreSubmissionWindowsPage from '@/app/(app)/admin/score-submission-windows/page';

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
              <h2 style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>科目與比重設定</h2>
              <CurriculumSettingsTab />
            </section>
            <section style={{ borderTop: '1px solid #eee', paddingTop: 24 }}>
              <h2 style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>整體佔比與加扣分規則</h2>
              <GradingRulesTab />
            </section>
            <section style={{ borderTop: '1px solid #eee', paddingTop: 24 }}>
              <h2 style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>殘留科目清理（成績表有分數、科目設定裡卻沒有的科目）</h2>
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

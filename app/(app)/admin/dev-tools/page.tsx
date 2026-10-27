'use client';

import { useEffect, useState } from 'react';
import { getCurrentAppUser } from '@/lib/supabaseClient';
import BackupRestorePanel from '@/components/dev-tools/BackupRestorePanel';
import BulkExcelPanel from '@/components/dev-tools/BulkExcelPanel';
import DeptWorkbookPanel from '@/components/dev-tools/DeptWorkbookPanel';
import Link from 'next/link';
import TeacherLettersPanel from '@/components/dev-tools/TeacherLettersPanel';
import PasswordPolicySettingsPanel from '@/components/dev-tools/PasswordPolicySettingsPanel';
import TeacherLoginHomeSettingsPanel from '@/components/dev-tools/TeacherLoginHomeSettingsPanel';
import AttendanceScoreExclusionPanel from '@/components/dev-tools/AttendanceScoreExclusionPanel';
import HomeroomAttendanceAssistPanel from '@/components/dev-tools/HomeroomAttendanceAssistPanel';
import { useDepartmentPermissions } from '@/lib/useDepartmentPermissions';
import { hasDepartment } from '@/lib/departments';

export default function DevToolsPage() {
  const [me, setMe] = useState<{ id: string; name: string; role: string } | null>(null);
  const perms = useDepartmentPermissions();

  useEffect(() => {
    (async () => {
      setMe(await getCurrentAppUser());
    })();
  }, []);

  // 歸屬開發人員(dev)部門：只有身兼「開發人員」職務的帳號（或系統管理員S）能用這頁，
  // 對應資料庫端 app_users／backups／account_audit_log 等表已經改成 is_system_admin() or has_department('dev')。
  const isAdmin = me && (perms.isSystemAdmin || hasDepartment(perms.myDepartments, 'dev'));

  if (me && !isAdmin) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16, marginBottom: 4 }}>開發人員區</h1>
        <p style={{ fontSize: 13, color: '#999' }}>只有管理員可以查看這個頁面。</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>開發人員資料中心</h1>
      <p style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
        跟系統維運相關的「下載／上傳／備份」全部集中在這一頁：四部門 Excel 一鍵下載／上傳、備份檔（JSON）下載／還原、聘書與教師歷年資料，
        以及排課、課表、成績單範本、打卡機資料等專用上傳入口的快速連結。一般日常操作（登錄成績、點名、查詢學生等）請到首頁其他分類的功能卡片。
      </p>

      <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, marginBottom: 24 }}>
        {[
          ['#dept-excel', '① 四部門 Excel'],
          ['#backup-restore', '② 備份檔 JSON／還原'],
          ['#other-uploads', '③ 其他檔案上傳入口'],
          ['#teacher-letters', '④ 聘書與教師歷年資料'],
          ['#legacy-excel', '⑤ 舊版整批工具'],
          ['#password-policy-settings', '⑥ 系統設定'],
        ].map(([href, label]) => (
          <a key={href} href={href} style={{ padding: '4px 10px', border: '1px solid #ccd', borderRadius: 14, color: '#2C6E9E', textDecoration: 'none' }}>
            {label}
          </a>
        ))}
      </nav>

      <section id="dept-excel" style={{ marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #eee' }}>
        <h2 style={{ fontSize: 14, marginBottom: 12 }}>① 四部門 Excel 一鍵下載／上傳（教務、總務、訓導、開發人員）</h2>
        <DeptWorkbookPanel />
      </section>

      <section id="backup-restore" style={{ marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #eee' }}>
        <h2 style={{ fontSize: 14, marginBottom: 12 }}>② 備份與還原（JSON 備份檔：完整、含全部出缺勤，適合災難復原）</h2>
        <BackupRestorePanel />
      </section>

      <section id="other-uploads" style={{ marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #eee' }}>
        <h2 style={{ fontSize: 14, marginBottom: 4 }}>③ 其他檔案上傳入口</h2>
        <p style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
          下面這些檔案有各自專用的格式，統一整理在這裡，點一下直接到對應的上傳位置（不用再去首頁一張一張卡片找）。
        </p>
        <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#666' }}>
              <th style={{ padding: '4px 8px' }}>檔案</th>
              <th style={{ padding: '4px 8px' }}>用途</th>
              <th style={{ padding: '4px 8px' }}>前往</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['排課工具專案 JSON、排課匯出 Excel', '自動排課、存檔到校務系統、歷史存檔', '/admin/scheduling-hub?tab=tool', '排課與代課中心 ①'],
              ['學校課表 Excel', '整批匯入／覆蓋全校課表', '/admin/scheduling-hub?tab=timetable', '排課與代課中心 ②'],
              ['課表資料整理', '清掉任課教師設定重複列', '/admin/scheduling-hub?tab=cleanup', '排課與代課中心 ⑥'],
              ['成績單 Word 合併列印範本', '成績單合併列印', '/admin/grading?tab=report-card-merge-template', '成績單合併列印範本'],
              ['成績單 Excel 範本', '成績單 Excel 版型', '/admin/grading?tab=report-card-xlsx-template', '成績單 Excel 範本'],
              ['打卡機 CSV', '教職員打卡匯入與同步', '/admin/staff-clock', '教職員打卡管理'],
              ['老師的成績／出缺勤輸入表', '代老師補登、小範圍修正', '/admin/teacher-desk', '教師代辦專區'],
              ['帳號名單', '邀請、停用、部門職務', '/admin/accounts', '帳號管理'],
            ].map(([file, use, href, label]) => (
              <tr key={href + file} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: '4px 8px' }}>{file}</td>
                <td style={{ padding: '4px 8px', color: '#777' }}>{use}</td>
                <td style={{ padding: '4px 8px' }}>
                  <Link href={href} style={{ color: '#2C6E9E' }}>
                    {label} →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section id="teacher-letters" style={{ marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #eee' }}>
        <h2 style={{ fontSize: 14, marginBottom: 4 }}>④ 聘書（歷年教師資料／自聘教師聘書／當年教師聘書／列印）</h2>
        <p style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
          原本要開Excel用VBA巨集列印的「教師資料」，改成在這裡管理：可以下載範本、整批上傳、下載目前資料，也可以逐筆新增/編輯/刪除。
        </p>
        <TeacherLettersPanel userId={me?.id ?? null} />
      </section>

      <section id="legacy-excel" style={{ marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #eee' }}>
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 14 }}>⑤ 舊版整批 Excel 工具（逐表格式；新版「四部門 Excel」已涵蓋全部資料表，只在需要舊格式範本時才用）</summary>
          <div style={{ marginTop: 12 }}>
            <BulkExcelPanel myRole={me?.role} />
          </div>
        </details>
      </section>

      <section id="password-policy-settings" style={{ marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #eee' }}>
        <h2 style={{ fontSize: 14, marginBottom: 4 }}>密碼政策設定</h2>
        <PasswordPolicySettingsPanel />
      </section>

      <section id="teacher-login-home-settings" style={{ marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #eee' }}>
        <h2 style={{ fontSize: 14, marginBottom: 4 }}>教師登入首頁設定</h2>
        <TeacherLoginHomeSettingsPanel />
      </section>

      <section id="attendance-score-exclusion" style={{ marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #eee' }}>
        <h2 style={{ fontSize: 14, marginBottom: 4 }}>班級成績總表：出缺席分數排除設定</h2>
        <AttendanceScoreExclusionPanel />
      </section>

      <section id="homeroom-attendance-assist">
        <h2 style={{ fontSize: 14, marginBottom: 4 }}>出缺席登錄：導師協助任課教師點名設定</h2>
        <HomeroomAttendanceAssistPanel />
      </section>
    </main>
  );
}

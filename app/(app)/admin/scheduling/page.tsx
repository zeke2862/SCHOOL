'use client';

import { useEffect, useRef, useState } from 'react';
import { resolveCurrentTerm } from '@/lib/academicTerm';
import { supabase } from '@/lib/supabaseClient';
import {
  buildCurriculumImportText,
  buildTeacherImportText,
  buildScheduleFromDb,
  importScheduleExcel,
  importScheduleFromProjectData,
  importCurriculumFromProjectData,
  importTeacherAssignmentsFromProjectData,
  ScheduleImportResult,
} from '@/lib/schedulerBridge';
import { saveSchedulerBackup } from '@/lib/schedulerBackupClient';
import SchedulerBackupPanel from '@/components/scheduling/SchedulerBackupPanel';

// 排課系統頁：這個工具本身（scheduler-tool.html）自己有「登記學年度」「匯入教師」「年級設定」
// 「排課」「查詢」「代課」「匯出Excel」這些分頁，本頁不重複做一樣的事，只負責：
//   1. 工具按「📥 從校務系統匯入」時，把目前資料庫裡的資料整理好回傳給它（取代手動複製貼上）。
//   2. 工具按「💾 存檔到校務系統」時，把它送過來的資料直接寫進資料庫（取代手動匯出/上傳Excel）。
// 「查課表／找代課」工具本身「查詢」「代課」分頁就有（而且是即時資料），這裡不重做一份，
// 避免兩邊操作邏輯不一致。這裡只保留「歷史存檔清單」（之前存過的版本，需要回頭看/還原時用）。
// 排課工具的版本號（要跟 public/scheduler/scheduler-tool.html 裡的 TOOL_VERSION 一致；改工具時兩邊一起改）
const EXPECTED_TOOL_VERSION = '2026-10-28-layout';

export default function SchedulingPage() {
  const [academicYear, setAcademicYear] = useState(new Date().getFullYear());
  const [term, setTerm] = useState<'上學期' | '下學期'>('上學期');

  const importInputRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(900);
  const [frameSrc, setFrameSrc] = useState(`/scheduler/scheduler-tool.html?v=${EXPECTED_TOOL_VERSION}`);
  const reloadedRef = useRef(false);
  const [staleNote, setStaleNote] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ScheduleImportResult | null>(null);

  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSaveResult, setAutoSaveResult] = useState<{ schedule: ScheduleImportResult | null; backupError?: string } | null>(null);
  const [importingToTool, setImportingToTool] = useState(false);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);

  const [savingTeachers, setSavingTeachers] = useState(false);
  const [teacherSaveResult, setTeacherSaveResult] = useState<{ classesUpserted: number; assignmentsUpserted: number; warnings: string[] } | null>(
    null
  );
  const [savingCurriculum, setSavingCurriculum] = useState(false);
  const [curriculumSaveResult, setCurriculumSaveResult] = useState<{ curriculumUpserted: number; warnings: string[] } | null>(null);

  useEffect(() => {
    async function handleMessage(evt: MessageEvent) {
      if (evt.origin !== window.location.origin) return;
      if (!evt.data || evt.data.source !== 'scheduler-tool') return;
      const sourceWindow = evt.source as Window | null;
      // 工具把自己的內容高度告訴我們，iframe 就撐到剛好，整頁只剩一條捲動軸（不用回「收到了」）
      if (evt.data.type === 'resize') {
        const h = Number(evt.data.height);
        if (h > 0) setFrameHeight(Math.max(500, Math.ceil(h) + 4));
        return;
      }
      // 工具裡的對話框要知道 iframe 目前有哪一段在畫面上，才放得進視線範圍
      if (evt.data.type === 'viewport-request') {
        const r = frameRef.current?.getBoundingClientRect();
        if (r) {
          const top = Math.max(0, -r.top);
          const height = Math.min(window.innerHeight, r.bottom - Math.max(0, r.top));
          sourceWindow?.postMessage({ source: 'school-system', type: 'viewport', top, height }, evt.origin);
        }
        return;
      }
      // 先回一聲「收到了」，讓排課工具知道校務系統頁面有在處理（寫資料庫可能要幾十秒），
      // 不會因為等太久就誤判「沒有收到校務系統的回應」。
      sourceWindow?.postMessage({ source: 'school-system', type: 'ack', requestType: evt.data.type }, evt.origin);

      // 工具跟我們要「目前資料庫裡已經有的教師/科目資料」，回傳格式跟以前「產生排課系統匯入文字」
      // 產生的文字一樣，只是不用使用者自己複製貼上，直接由工具收到後自動套用。
      // 瀏覽器還在用舊版排課工具（沒收到最新的程式）：自動換一個網址強制重新載入一次，
      // 不然舊版不認得新的班級名稱（例如「幼乙忠」），匯入時幼兒園會整批消失。
      if (evt.data.type === 'request-import-data' && evt.data.toolVersion !== EXPECTED_TOOL_VERSION) {
        if (!reloadedRef.current) {
          reloadedRef.current = true;
          setStaleNote('偵測到排課工具是舊版，正在自動更新並重新載入…');
          setFrameSrc(`/scheduler/scheduler-tool.html?v=${EXPECTED_TOOL_VERSION}&r=${Date.now()}`);
        } else {
          setStaleNote('排課工具仍是舊版，請在這個頁面按 Ctrl+F5 強制重新整理。');
        }
        return;
      }
      if (evt.data.type === 'request-import-data') {
        // 學年度／學期一律以「學年學期管理」目前生效的那一筆為準，排課工具不再自己設定
        const sys = await resolveCurrentTerm().catch(() => null);
        const ay = Number(sys?.academic_year ?? evt.data.academicYear) || academicYear;
        const tm: '上學期' | '下學期' = (sys?.term ?? evt.data.term) === '下學期' ? '下學期' : '上學期';
        setAcademicYear(ay);
        setTerm(tm);
        setImportingToTool(true);
        try {
          const [c, t] = await Promise.all([buildCurriculumImportText(ay, tm), buildTeacherImportText(ay, tm)]);
          const { data: lockedPeriods } = await supabase
            .from('locked_periods')
            .select('scope, scope_ref, weekday, period_no, subject, note')
            .eq('academic_year', ay)
            .eq('term', tm);
          // 讀取「最新一筆存檔」（含已排好的課表、手動調整、規則、教師不排課時段），
          // 讓排課工具一打開就能把先前存好的課表讀回來繼續調整。讀不到不影響其他匯入。
          let savedProject: any = null;
          try {
            const { data: latest } = await supabase
              .from('scheduler_backups')
              .select('data')
              .eq('academic_year', ay)
              .eq('term', tm)
              .order('saved_at', { ascending: false })
              .limit(1);
            savedProject = latest?.[0]?.data ?? null;
          } catch {
            savedProject = null;
          }
          // 沒有任何歷史存檔時，改從資料庫已存的班級課表（class_schedule）還原，排好的課表重新開啟也不會消失
          let dbSchedule: any[] = [];
          if (!savedProject?.S?.schedules || !Object.keys(savedProject.S.schedules).length) {
            try {
              dbSchedule = (await buildScheduleFromDb(ay, tm)).rows;
            } catch {
              dbSchedule = [];
            }
          }
          sourceWindow?.postMessage(
            {
              source: 'school-system',
              type: 'import-data',
              academicYear: ay,
              term: tm,
              curriculumText: c.text,
              teacherText: t.text,
              warnings: [...c.warnings, ...t.warnings],
              lockedPeriods: lockedPeriods ?? [],
              savedProject,
              dbSchedule,
            },
            evt.origin
          );
        } catch (err: any) {
          // 原本這裡沒有 catch：只要中間任何一步意外丟出例外（不是 Supabase 查詢回傳的
          // {error}，是真的 throw），就完全不會回訊息給工具，工具那邊會誤以為「沒有收到回應」
          // 卡滿15秒逾時，看不出真正的錯誤在哪。改成一定要回一則訊息，把錯誤內容也帶回去。
          sourceWindow?.postMessage(
            { source: 'school-system', type: 'import-data', academicYear: ay, term: tm, curriculumText: '', teacherText: '', warnings: ['匯入失敗：' + (err.message ?? String(err))], lockedPeriods: [] },
            evt.origin
          );
        } finally {
          setImportingToTool(false);
        }
        return;
      }

      // 「匯入教師 & 導師資料」分頁：可以匯入後立刻單獨存進資料庫，不用等整個排課流程做完，
      // 也不用先通過衝堂檢查（這裡不動實際排課時段，只寫導師/任課教師設定）。
      if (evt.data.type === 'save-teachers') {
        const projectData = evt.data.data;
        const ay = Number(projectData?.S?.academicYear) || academicYear;
        const tm: '上學期' | '下學期' = projectData?.S?.term === '下學期' ? '下學期' : '上學期';
        setAcademicYear(ay);
        setTerm(tm);
        setSavingTeachers(true);
        let ok = true;
        try {
          const result = await importTeacherAssignmentsFromProjectData(projectData, ay, tm);
          setTeacherSaveResult(result);
        } catch (err: any) {
          ok = false;
          setTeacherSaveResult({ classesUpserted: 0, assignmentsUpserted: 0, warnings: [err.message ?? '存檔失敗'] });
        } finally {
          setSavingTeachers(false);
          sourceWindow?.postMessage({ source: 'school-system', type: 'save-teachers-result', ok }, evt.origin);
        }
        return;
      }

      // 「全校科目節數匯入」分頁：同樣可以匯入後立刻單獨存進資料庫
      if (evt.data.type === 'save-curriculum') {
        const projectData = evt.data.data;
        const ay = Number(projectData?.S?.academicYear) || academicYear;
        const tm: '上學期' | '下學期' = projectData?.S?.term === '下學期' ? '下學期' : '上學期';
        setAcademicYear(ay);
        setTerm(tm);
        setSavingCurriculum(true);
        let ok = true;
        try {
          const result = await importCurriculumFromProjectData(projectData, ay, tm);
          setCurriculumSaveResult(result);
        } catch (err: any) {
          ok = false;
          setCurriculumSaveResult({ curriculumUpserted: 0, warnings: [err.message ?? '存檔失敗'] });
        } finally {
          setSavingCurriculum(false);
          sourceWindow?.postMessage({ source: 'school-system', type: 'save-curriculum-result', ok }, evt.origin);
        }
        return;
      }

      // 「📝 暫存草稿」：只把整包專案資料存進 scheduler_backups（歷史存檔），
      // 不寫班級課表資料表、不要求零衝堂，排到一半或手動調整到一半都可以先存起來。
      if (evt.data.type === 'save-draft') {
        const projectData = evt.data.data;
        const ay = Number(projectData?.S?.academicYear) || academicYear;
        const tm: '上學期' | '下學期' = projectData?.S?.term === '下學期' ? '下學期' : '上學期';
        setAcademicYear(ay);
        setTerm(tm);
        let ok = false;
        let errMsg = '';
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token;
          if (!accessToken) {
            errMsg = '未登入或登入已逾時，請重新登入';
          } else {
            const r = await saveSchedulerBackup(projectData, ay, tm, '排課工具「暫存草稿」', accessToken);
            ok = r.success;
            if (!r.success) errMsg = r.error ?? '儲存失敗';
          }
        } catch (err: any) {
          errMsg = err.message ?? '儲存失敗';
        }
        setDraftMsg(ok ? `草稿已暫存（${new Date().toLocaleTimeString()}）` : `暫存草稿失敗：${errMsg}`);
        sourceWindow?.postMessage({ source: 'school-system', type: 'save-draft-result', ok, error: errMsg }, evt.origin);
        return;
      }

      // 工具排課完成，按「💾 存檔到校務系統」送資料過來：直接寫回班級/課表/科目節數，
      // 同時把整包專案資料存進 scheduler_backups。
      if (evt.data.type === 'save') {
        const projectData = evt.data.data;
        const ay = Number(projectData?.S?.academicYear) || academicYear;
        const tm: '上學期' | '下學期' = projectData?.S?.term === '下學期' ? '下學期' : '上學期';
        setAcademicYear(ay);
        setTerm(tm);
        setAutoSaving(true);
        setAutoSaveResult(null);

        let ok = true;
        try {
          const scheduleResult = await importScheduleFromProjectData(projectData, ay, tm);
          let backupError: string | undefined;
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token;
          if (accessToken) {
            const backupResult = await saveSchedulerBackup(projectData, ay, tm, '排課工具「存檔到校務系統」自動存檔', accessToken);
            if (!backupResult.success) backupError = backupResult.error;
          } else {
            backupError = '未登入，無法把完整專案存檔存進系統（班級/課表/科目節數仍已寫入成功）';
          }
          setAutoSaveResult({ schedule: scheduleResult, backupError });
        } catch (err: any) {
          ok = false;
          setAutoSaveResult({ schedule: null, backupError: err.message ?? '存檔失敗' });
        } finally {
          setAutoSaving(false);
          sourceWindow?.postMessage({ source: 'school-system', type: 'save-result', ok }, evt.origin);
        }
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await importScheduleExcel(file, academicYear, term);
      setImportResult(result);
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      {staleNote && <p style={{ fontSize: 12, color: '#A36A00', marginBottom: 8 }}>{staleNote}</p>}
      {importingToTool && <p style={{ fontSize: 12, color: '#2C6E9E', marginBottom: 8 }}>正在把校務系統資料傳給排課工具…</p>}
      {autoSaving && <p style={{ fontSize: 12, color: '#2C6E9E', marginBottom: 8 }}>排課工具存檔中，班級數多時可能要等一下…</p>}
      {draftMsg && <p style={{ fontSize: 12, color: draftMsg.includes('失敗') ? '#A32D2D' : '#3B6D11', marginBottom: 8 }}>{draftMsg}</p>}
      {autoSaveResult && (
        <div style={{ fontSize: 12, marginBottom: 16, background: '#F5F5F3', borderRadius: 8, padding: 12 }}>
          {autoSaveResult.schedule && (
            <p style={{ color: '#3B6D11' }}>
              已存進校務系統：班級 {autoSaveResult.schedule.classesUpserted} 筆、科目節數 {autoSaveResult.schedule.curriculumUpserted} 筆、
              課表時段 {autoSaveResult.schedule.scheduleUpserted} 筆
            </p>
          )}
          {autoSaveResult.backupError && <p style={{ color: '#A32D2D' }}>{autoSaveResult.backupError}</p>}
          {autoSaveResult.schedule && autoSaveResult.schedule.warnings.length > 0 && (
            <ul style={{ color: '#7a5a00', paddingLeft: 18, marginTop: 6 }}>
              {autoSaveResult.schedule.warnings.slice(0, 30).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {autoSaveResult.schedule.warnings.length > 30 && <li>…還有 {autoSaveResult.schedule.warnings.length - 30} 則提醒</li>}
            </ul>
          )}
        </div>
      )}

      {savingTeachers && <p style={{ fontSize: 12, color: '#2C6E9E', marginBottom: 8 }}>「匯入教師 & 導師資料」存檔中…</p>}
      {teacherSaveResult && (
        <div style={{ fontSize: 12, marginBottom: 16, background: '#F5F5F3', borderRadius: 8, padding: 12 }}>
          <p style={{ color: '#3B6D11' }}>
            已存進校務系統：班級 {teacherSaveResult.classesUpserted} 筆、任課教師/導師設定 {teacherSaveResult.assignmentsUpserted} 筆
          </p>
          {teacherSaveResult.warnings.length > 0 && (
            <ul style={{ color: '#7a5a00', paddingLeft: 18, marginTop: 6 }}>
              {teacherSaveResult.warnings.slice(0, 30).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {teacherSaveResult.warnings.length > 30 && <li>…還有 {teacherSaveResult.warnings.length - 30} 則提醒</li>}
            </ul>
          )}
        </div>
      )}

      {savingCurriculum && <p style={{ fontSize: 12, color: '#2C6E9E', marginBottom: 8 }}>「全校科目節數匯入」存檔中…</p>}
      {curriculumSaveResult && (
        <div style={{ fontSize: 12, marginBottom: 16, background: '#F5F5F3', borderRadius: 8, padding: 12 }}>
          <p style={{ color: '#3B6D11' }}>已存進校務系統：科目節數 {curriculumSaveResult.curriculumUpserted} 筆</p>
          {curriculumSaveResult.warnings.length > 0 && (
            <ul style={{ color: '#7a5a00', paddingLeft: 18, marginTop: 6 }}>
              {curriculumSaveResult.warnings.slice(0, 30).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {curriculumSaveResult.warnings.length > 30 && <li>…還有 {curriculumSaveResult.warnings.length - 30} 則提醒</li>}
            </ul>
          )}
        </div>
      )}

      <iframe
        ref={frameRef}
        src={frameSrc}
        scrolling="no"
        style={{ width: '100%', height: frameHeight, border: 'none', display: 'block' }}
        title="排課系統"
      />

      <details style={{ marginTop: 24 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: '#2C6E9E', fontWeight: 'bold' }}>
          進階：也可以手動匯出/匯入Excel（例如要離線核對課表、或存檔按鈕沒反應時的備用方式）
        </summary>
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 11, color: '#999', marginBottom: 10 }}>
            排課工具「匯出Excel」產生的檔案，或學校平常使用的「課程表系統」Excel（.xlsx／.xlsm，不需要有「匯入的年級&科目&節數」工作表，節數會直接從課表數出來），上傳後一樣會自動寫入「班級與導師」「科目節數」「班級課表」（適用學年度／學期：{academicYear}／{term}）。
            科目比重（用於成績計算）排課系統沒有這項資料，會先寫入 0，請匯入後到「成績相關設定及查詢」第一分頁補上正確比重。
          </p>
          <input ref={importInputRef} type="file" accept=".xlsx,.xlsm" onChange={handleImportFile} disabled={importing} style={{ fontSize: 13 }} />
          {importing && <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>匯入中，班級數多時可能要等一下…</p>}
          {importResult && (
            <div style={{ fontSize: 12, marginTop: 12 }}>
              <p style={{ color: '#3B6D11' }}>
                已建立/更新班級 {importResult.classesUpserted} 筆、科目節數 {importResult.curriculumUpserted} 筆、課表時段 {importResult.scheduleUpserted} 筆
              </p>
              {importResult.warnings.length > 0 && (
                <ul style={{ color: '#7a5a00', paddingLeft: 18, marginTop: 6 }}>
                  {importResult.warnings.slice(0, 30).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {importResult.warnings.length > 30 && <li>…還有 {importResult.warnings.length - 30} 則提醒</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      </details>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: '#2C6E9E', fontWeight: 'bold' }}>
          歷史存檔清單（查看/還原之前存過的版本）
        </summary>
        <div style={{ marginTop: 12 }}>
          <SchedulerBackupPanel academicYear={academicYear} term={term} />
        </div>
      </details>
    </main>
  );
}

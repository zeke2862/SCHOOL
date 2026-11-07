'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { estimateTermStart, resolveCurrentTerm } from '@/lib/academicTerm';
import { suggestReturnSeat } from '@/lib/seatSuggest';
import { upsertEnrollment } from '@/lib/bulkHandlers';

const STATUS_OPTIONS = ['入學', '休學', '轉學', '退學', '畢業', '肄業', '復學'] as const;
const HIDDEN_STATUSES = ['休學', '轉學', '退學', '畢業', '肄業'] as const;

const TEMPLATE_FILES: Record<string, string> = {
  入學: '/templates/入學申請書.docx',
  休學: '/templates/休學申請書.docx',
  轉學: '/templates/轉學申請書.docx',
  退學: '/templates/退學申請書.docx',
  畢業: '/templates/畢業離校確認書.docx',
  肄業: '/templates/肄業證明申請書.docx',
  復學: '/templates/復學申請書.docx',
};

type HiddenStudentRow = { student_no: string; name: string; status: string; effective_date: string };

export default function StatusChangePage() {
  const [studentNo, setStudentNo] = useState('');
  const [studentName, setStudentName] = useState<string | null>(null);
  // 【本輪新增】反映事項「高二忠班 馬成孝已休學但成績上仍可以看到他且排名為
  // 第一，點名表上他也還存在。請再確認休學、轉學、退學的設定，同時把所有有
  // 學籍更動的學生都修正好」：查詢學號時，順便把系統目前記錄到的「最新狀態」
  // 也顯示出來——如果查到的最新狀態不是「休學」，代表系統裡根本沒有這筆
  // 休學紀錄（可能是當初儲存失敗、或用了別的方式登記），這種情況不是「隱藏
  // 名單的規則沒生效」，是「這筆狀態變更根本沒被記錄到」，需要重新在下面
  // 表單登記一次。
  const [currentStatus, setCurrentStatus] = useState<{ status: string; effective_date: string } | null | undefined>(undefined);
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('休學');
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);

  const [hiddenList, setHiddenList] = useState<HiddenStudentRow[] | null>(null);
  const [hiddenListError, setHiddenListError] = useState<string | null>(null);
  const [loadingHiddenList, setLoadingHiddenList] = useState(false);
  // 「應隱藏」名單預設只列這學期（生效日在本學期開學日之後）的學生，更早學期的要管理人特別點選才會顯示
  const [termStart, setTermStart] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);

  // 復學時同步編班＋換新座號：建議「該班最後一號＋1」，並顯示班上目前用到幾號
  const [classOptions, setClassOptions] = useState<{ id: string; label: string }[]>([]);
  const [returnTerm, setReturnTerm] = useState('上學期');
  const [returnClassId, setReturnClassId] = useState('');
  const [returnSeat, setReturnSeat] = useState('');
  const [returnSeatNote, setReturnSeatNote] = useState('');
  const [alsoEnroll, setAlsoEnroll] = useState(true);
  const isReturn = status === '復學';

  // 載入本學年的班級；預設學期＝目前學期
  useEffect(() => {
    (async () => {
      const cur = await resolveCurrentTerm();
      if (!cur) return;
      setReturnTerm(cur.term);
      const { data } = await supabase.from('classes').select('id, department, grade_level, class_name').eq('academic_year', cur.academic_year);
      setClassOptions(
        (data ?? []).map((c: any) => ({ id: c.id, label: `${c.department} ${c.grade_level}${c.class_name}` })).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
      );
    })();
  }, []);

  // 查到學生後，班級預設帶他最近一次所在的班（若該班屬於本學年）
  useEffect(() => {
    if (!studentName || !isReturn || !studentNo) return;
    (async () => {
      const { data } = await supabase.from('enrollments').select('class_id').eq('student_no', studentNo).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data?.class_id && classOptions.some((c) => c.id === data.class_id)) setReturnClassId(data.class_id);
    })();
  }, [studentName, isReturn, studentNo, classOptions]);

  // 選班級／學期後，座號自動帶入「班上最後一號＋1」，可手動修改
  useEffect(() => {
    let cancelled = false;
    setReturnSeatNote('');
    if (!isReturn || !returnClassId || !studentNo) return;
    suggestReturnSeat(returnClassId, returnTerm, studentNo).then((s) => {
      if (cancelled || !s) return;
      setReturnSeat(String(s.seat));
      setReturnSeatNote(s.note);
    });
    return () => {
      cancelled = true;
    };
  }, [isReturn, returnClassId, returnTerm, studentNo]);

  async function loadHiddenList() {
    setLoadingHiddenList(true);
    setHiddenListError(null);
    // 【本輪新增】直接把「系統目前判定為應該隱藏」的學生名單列出來，給管理員
    // 對照——每個學生只看最新一筆狀態紀錄（跟 student_is_hidden() 用的邏輯
    // 一致：按 effective_date、created_at 排序取最新一筆）。如果名單裡沒看到
    // 某位學生（例如馬成孝），代表系統裡根本沒有他的休學紀錄，需要重新登記。
    const { data, error } = await supabase
      .from('student_status_changes')
      .select('student_no, status, effective_date, created_at, students(name)')
      .order('student_no')
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false });
    setLoadingHiddenList(false);
    if (error) {
      setHiddenListError('讀取失敗：' + error.message);
      return;
    }
    // 每個學生只留「最新一筆」（資料已經照 student_no, effective_date desc, created_at desc 排序，
    // 同一學號第一次出現的就是最新那筆）。
    const latestByStudent = new Map<string, HiddenStudentRow>();
    (data ?? []).forEach((r: any) => {
      if (!latestByStudent.has(r.student_no)) {
        latestByStudent.set(r.student_no, {
          student_no: r.student_no,
          name: r.students?.name ?? r.student_no,
          status: r.status,
          effective_date: r.effective_date,
        });
      }
    });
    const hidden = Array.from(latestByStudent.values()).filter((r) => (HIDDEN_STATUSES as readonly string[]).includes(r.status));
    setHiddenList(hidden);
  }

  async function lookupStudent() {
    const { data } = await supabase.from('students').select('name').eq('student_no', studentNo).maybeSingle();
    setStudentName(data?.name ?? null);
    if (!data) {
      setCurrentStatus(undefined);
      return;
    }
    const { data: latest } = await supabase
      .from('student_status_changes')
      .select('status, effective_date')
      .eq('student_no', studentNo)
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setCurrentStatus(latest ?? null);
  }

  useEffect(() => {
    loadHiddenList();
    (async () => {
      const cur = await resolveCurrentTerm();
      if (!cur) return;
      const { data } = await supabase
        .from('academic_terms')
        .select('term_start_date')
        .eq('academic_year', cur.academic_year)
        .eq('term', cur.term)
        .maybeSingle();
      setTermStart(data?.term_start_date ?? estimateTermStart(cur.academic_year, cur.term));
    })();
  }, []);

  const currentHidden = (hiddenList ?? []).filter((r) => !termStart || r.effective_date >= termStart);
  const olderHidden = (hiddenList ?? []).filter((r) => termStart && r.effective_date < termStart);
  const shownHidden = showOlder ? [...currentHidden, ...olderHidden] : currentHidden;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentName) {
      alert('請先查詢確認學號正確');
      return;
    }
    // 復學同步編班：先檢查班級、座號都填了，且座號沒被別人用，免得狀態記了卻編班失敗
    const doEnroll = isReturn && alsoEnroll;
    if (doEnroll) {
      const seat = Number(returnSeat);
      if (!returnClassId || !Number.isInteger(seat) || seat < 1) {
        alert('請選擇復學的班級並填入座號（或取消勾選「同時編入班級」，之後再到學籍設定編班）');
        return;
      }
      const { data: taken } = await supabase.from('enrollments').select('student_no').eq('class_id', returnClassId).eq('term', returnTerm).eq('seat_no', seat).maybeSingle();
      if (taken && taken.student_no !== studentNo) {
        alert(`座號 ${seat} 已經被學號 ${taken.student_no} 使用，請改用其他座號`);
        return;
      }
    }
    setSaving(true);

    const { data: statusRow, error } = await supabase
      .from('student_status_changes')
      .insert({ student_no: studentNo, status, effective_date: effectiveDate, reason })
      .select('id')
      .single();

    if (error || !statusRow) {
      alert('儲存失敗：' + error?.message);
      setSaving(false);
      return;
    }

    // 上傳佐證資料（若有選擇檔案）
    if (files && files.length > 0) {
      for (const file of Array.from(files)) {
        const path = `status-changes/${statusRow.id}/${file.name}`;
        const { error: uploadError } = await supabase.storage.from('student-documents').upload(path, file);
        if (uploadError) {
          alert(`檔案「${file.name}」上傳失敗：${uploadError.message}`);
          continue;
        }
        await supabase.from('status_change_attachments').insert({
          status_change_id: statusRow.id,
          file_url: path,
          file_name: file.name,
        });
      }
    }

    if (doEnroll) {
      try {
        await upsertEnrollment(studentNo, returnClassId, returnTerm, Number(returnSeat));
        alert(`已記錄復學，並編入班級，新座號 ${returnSeat}`);
      } catch (enrollError: any) {
        alert('復學狀態已記錄，但編班失敗：' + enrollError.message + '。請到「學籍設定及查詢」補編班。');
      }
    } else {
      alert('已記錄學籍狀態變化');
    }
    setSaving(false);
    setReason('');
    setFiles(null);
    setCurrentStatus({ status, effective_date: effectiveDate });
    loadHiddenList();
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>學籍狀態變更</h1>
      <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 16 }}>
        休學／轉學／退學／畢業／肄業／復學，直接記錄狀態變化即可，不需要審核流程。可附加佐證資料（例如休學證明、家長申請書掃描檔）。
        休學／轉學／退學／畢業／肄業這五種狀態記錄後，這位學生的出缺勤／成績等資料會自動從一般查詢畫面（成績登錄、出缺勤登錄、學生名冊等）隱藏，只有管理員查得到；
        休學期間座號仍會保留（不會釋放給別人）。復學時選「復學」，下方會出現編班欄位：已開學的學期預設帶入班上最後一號＋1 的新座號（全班座號已安排好，不插入；並顯示班上目前用到幾號），還沒開學則沿用原座號。按儲存就同時完成狀態記錄與編班，資料立刻恢復正常顯示。
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          placeholder="輸入學號"
          value={studentNo}
          onChange={(e) => {
            setStudentNo(e.target.value);
            setStudentName(null);
            setCurrentStatus(undefined);
          }}
          style={{ padding: 8, flex: 1 }}
        />
        <button type="button" onClick={lookupStudent} style={{ padding: '8px 16px' }}>
          查詢
        </button>
      </div>
      {studentName && (
        <p style={{ fontSize: 13, marginBottom: 16 }}>
          學生：{studentName}
          {currentStatus === undefined ? null : currentStatus === null ? (
            <span style={{ color: '#1E7B45' }}>（系統目前沒有任何學籍狀態變更紀錄，視為在學中）</span>
          ) : (
            <span style={{ color: (HIDDEN_STATUSES as readonly string[]).includes(currentStatus.status) ? '#A32D2D' : '#1E7B45' }}>
              （系統目前記錄的最新狀態：{currentStatus.status}，生效日 {currentStatus.effective_date}）
            </span>
          )}
        </p>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ fontSize: 13 }}>
          狀態
          <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={{ display: 'block', padding: 8, width: '100%', marginTop: 4 }}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <a href={TEMPLATE_FILES[status]} download style={{ fontSize: 13, color: 'var(--primary-ink)' }}>
          ↓ 下載「{status}」申請書範本（Word），給家長/學生簽名後掃描成PDF再上傳
        </a>

        <label style={{ fontSize: 13 }}>
          生效日期
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            style={{ display: 'block', padding: 8, width: '100%', marginTop: 4 }}
          />
        </label>

        {isReturn && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, background: 'var(--tint, #FAFAF5)' }}>
            <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <input type="checkbox" checked={alsoEnroll} onChange={(e) => setAlsoEnroll(e.target.checked)} />
              同時編入班級並換新座號（建議）
            </label>
            {alsoEnroll && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={returnClassId} onChange={(e) => setReturnClassId(e.target.value)} style={{ padding: 8, flex: 1 }}>
                    <option value="">選擇復學班級</option>
                    {classOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <select value={returnTerm} onChange={(e) => setReturnTerm(e.target.value)} style={{ padding: 8 }}>
                    <option value="上學期">上學期</option>
                    <option value="下學期">下學期</option>
                  </select>
                </div>
                <input type="number" min={1} placeholder="新座號" value={returnSeat} onChange={(e) => setReturnSeat(e.target.value)} style={{ padding: 8 }} />
                {returnSeatNote && <div style={{ fontSize: 12, color: 'var(--sub)' }}>{returnSeatNote}</div>}
              </div>
            )}
          </div>
        )}

        <label style={{ fontSize: 13 }}>
          原因（選填）
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ display: 'block', padding: 8, width: '100%', marginTop: 4 }} rows={3} />
        </label>

        <label style={{ fontSize: 13 }}>
          佐證資料上傳（例如簽名掃描後的申請書PDF，選填，可多選）
          <input type="file" multiple accept="application/pdf" onChange={(e) => setFiles(e.target.files)} style={{ display: 'block', marginTop: 4 }} />
        </label>

        <button
          type="submit"
          disabled={saving}
          style={{ padding: 12, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, marginTop: 8 }}
        >
          {saving ? '儲存中…' : '儲存'}
        </button>
      </form>

      {/* 【本輪新增】反映事項「請再確認休學、轉學、退學的設定，同時把所有有學籍
          更動的學生都修正好」——直接把系統目前判定「應該被隱藏」的學生名單列出來，
          方便對照：如果某位已經辦好休學/轉學/退學的學生沒有出現在這份名單裡，
          代表系統裡根本沒有記錄到這筆狀態變更，需要用上面的表單重新登記一次
          （而不是隱藏規則本身有問題）。 */}
      <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h2 style={{ fontSize: 14 }}>目前系統判定「應隱藏」的學生名單</h2>
          <button type="button" onClick={loadHiddenList} disabled={loadingHiddenList} style={{ fontSize: 12, padding: '2px 10px' }}>
            {loadingHiddenList ? '讀取中…' : '重新整理'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 8 }}>
          休學／轉學／退學／畢業／肄業狀態的學生，一般教師查成績、出缺勤、學生名冊時應該都看不到他們。這份名單就是系統實際依照這個規則判定出來的結果——
          如果某位學生明明已經辦好離校手續、卻沒有出現在下面，代表系統裡沒有他的狀態變更紀錄，用上面的表單補登記即可。
        </p>
        {hiddenListError && <p style={{ fontSize: 12, color: '#A32D2D' }}>{hiddenListError}</p>}
        {hiddenList && termStart && (
          <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 8 }}>
            預設只列本學期（{termStart} 起）的名單。
            {olderHidden.length > 0 ? (
              <button type="button" onClick={() => setShowOlder(!showOlder)} style={{ marginLeft: 8, fontSize: 12, padding: '2px 10px' }}>
                {showOlder ? '收起以前學期的名單' : `顯示以前學期的名單（${olderHidden.length} 位）`}
              </button>
            ) : (
              '以前學期沒有應隱藏的學生。'
            )}
          </p>
        )}
        {hiddenList && shownHidden.length === 0 && !hiddenListError && (
          <p style={{ fontSize: 12, color: 'var(--sub)' }}>{termStart && !showOlder ? '本學期目前沒有學生被系統判定為應隱藏。' : '目前沒有任何學生被系統判定為應隱藏。'}</p>
        )}
        {hiddenList && shownHidden.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid var(--line)', padding: '4px 8px' }}>學號</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid var(--line)', padding: '4px 8px' }}>姓名</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid var(--line)', padding: '4px 8px' }}>最新狀態</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid var(--line)', padding: '4px 8px' }}>生效日</th>
              </tr>
            </thead>
            <tbody>
              {shownHidden.map((r) => (
                <tr key={r.student_no}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{r.student_no}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{r.name}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{r.status}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{r.effective_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabase, getCurrentAppUser, isAdminInCurrentView } from '@/lib/supabaseClient';
import { resolveCurrentTerm } from '@/lib/academicTerm';

// ============================================================
// 教師代辦專區
// ------------------------------------------------------------
// 目的：開發人員／管理員要幫老師做「小範圍修正」（補登成績、補點名、重新上傳他的輸入表…）時，
// 不用再自己去找「這位老師教哪些班、該去哪一頁」。
// 選一位老師 → 列出他的導師班、任課班級與科目、社團 → 每一項直接帶你進入對應的教師頁面
// （網址已經帶好班級，管理員身分在那些頁面本來就能選任何班級、上傳／下載該班的 Excel）。
// 所有修改都會照原本的規則留下修改紀錄（成績／出缺勤稽核紀錄），不會繞過任何機制。
// ============================================================

type Teacher = { id: string; name: string };
type ClassRow = { id: string; academic_year: number; grade_level: string; class_name: string; homeroom_teacher_id: string | null };
type Club = { id: string; name: string; academic_year: number; term: string };

const linkStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  fontSize: 12,
  border: '1px solid #2C6E9E',
  color: '#2C6E9E',
  borderRadius: 6,
  textDecoration: 'none',
  marginRight: 6,
  marginBottom: 6,
  background: '#fff',
};

export default function TeacherDeskPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [keyword, setKeyword] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [yearInfo, setYearInfo] = useState<{ academic_year: number; term: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [homerooms, setHomerooms] = useState<ClassRow[]>([]);
  const [taught, setTaught] = useState<{ cls: ClassRow; subjects: string[] }[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);

  useEffect(() => {
    (async () => {
      const me = await getCurrentAppUser();
      setAllowed(!!me && isAdminInCurrentView(me.role));
      const { data } = await supabase.from('teachers').select('id, name').order('name');
      setTeachers((data ?? []) as Teacher[]);
      setYearInfo(await resolveCurrentTerm());
    })();
  }, []);

  useEffect(() => {
    if (!teacherId) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const year = yearInfo?.academic_year;
        let classQ = supabase.from('classes').select('id, academic_year, grade_level, class_name, homeroom_teacher_id');
        if (year != null) classQ = classQ.eq('academic_year', year);
        const [{ data: classRows, error: cErr }, { data: schedRows, error: sErr }, { data: clubRows }] = await Promise.all([
          classQ,
          supabase.from('class_schedule').select('class_id, subject, academic_year').eq('teacher_id', teacherId),
          supabase.from('clubs').select('id, name, academic_year, term').eq('teacher_id', teacherId),
        ]);
        if (cErr || sErr) throw new Error(cErr?.message ?? sErr?.message);
        const classes = (classRows ?? []) as ClassRow[];
        const byId = new Map(classes.map((c) => [c.id, c]));
        setHomerooms(classes.filter((c) => c.homeroom_teacher_id === teacherId));
        const subj = new Map<string, Set<string>>();
        for (const r of (schedRows ?? []) as any[]) {
          if (!byId.has(r.class_id)) continue; // 不是目前學年度的班級就略過
          if (!subj.has(r.class_id)) subj.set(r.class_id, new Set());
          subj.get(r.class_id)!.add(r.subject);
        }
        setTaught(
          [...subj.entries()]
            .map(([cid, s]) => ({ cls: byId.get(cid)!, subjects: [...s].sort() }))
            .sort((a, b) => (a.cls.grade_level + a.cls.class_name).localeCompare(b.cls.grade_level + b.cls.class_name, 'zh-Hant'))
        );
        setClubs((clubRows ?? []) as Club[]);
      } catch (e: any) {
        setError(e.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [teacherId, yearInfo]);

  const filtered = useMemo(() => teachers.filter((t) => !keyword.trim() || t.name.toLowerCase().includes(keyword.trim().toLowerCase())), [teachers, keyword]);
  const teacherName = teachers.find((t) => t.id === teacherId)?.name ?? '';

  if (allowed === null) return <p style={{ padding: 24, fontSize: 13, color: '#999' }}>載入中…</p>;
  if (!allowed) {
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16 }}>教師代辦專區</h1>
        <p style={{ fontSize: 13, color: '#999' }}>只有管理員（系統管理員S／A／B）可以使用。</p>
      </main>
    );
  }

  const classLabel = (c: ClassRow) => `${c.grade_level}${c.class_name}`;

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>教師代辦專區</h1>
      <p style={{ fontSize: 12, color: '#999', marginBottom: 16, lineHeight: 1.7 }}>
        要幫老師補登成績、補點名、或重新上傳／下載他的輸入表時，先在這裡選老師，下面會列出他教的班級與科目，
        每個按鈕都會直接帶你進入對應的教師頁面（管理員身分在那些頁面可以選任何班級，一樣有「下載輸入表／上傳輸入表」按鈕）。
        目前學年度：{yearInfo ? `${yearInfo.academic_year} ${yearInfo.term}` : '（尚未設定）'}。所有修改都會照原本規則留下修改紀錄。
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="輸入老師姓名搜尋" style={{ padding: 6, fontSize: 13, width: 180 }} />
        <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} style={{ padding: 6, fontSize: 13, minWidth: 220 }}>
          <option value="">— 選擇老師（{filtered.length} 位）—</option>
          {filtered.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <p style={{ fontSize: 12, color: '#2C6E9E' }}>讀取中…</p>}
      {error && <p style={{ fontSize: 12, color: '#A32D2D' }}>讀取失敗：{error}</p>}

      {teacherId && !loading && (
        <>
          <h2 style={{ fontSize: 14, margin: '8px 0' }}>{teacherName} 老師</h2>

          <section style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>導師班</h3>
            {homerooms.length === 0 && <p style={{ fontSize: 12, color: '#999' }}>這位老師目前沒有帶班。</p>}
            {homerooms.map((c) => (
              <div key={c.id} style={{ border: '1px solid #e3e3e3', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 6 }}>{classLabel(c)}</div>
                <Link href={`/admin/grading?tab=entry&classId=${c.id}`} style={linkStyle}>成績登錄／成績輸入表</Link>
                <Link href={`/attendance/weekly?classId=${c.id}`} style={linkStyle}>出缺席登錄（一週）／輸入表</Link>
                <Link href="/attendance/mobile" style={linkStyle}>出缺席登錄（每日）</Link>
                <Link href="/attendance/report" style={linkStyle}>出席紀錄查詢</Link>
                <Link href="/admin/grading?tab=conduct" style={linkStyle}>操行成績</Link>
                <Link href="/discipline/rewards" style={linkStyle}>獎懲登記</Link>
                <Link href="/exam-rosters" style={linkStyle}>考場名單</Link>
                <Link href="/admin/students/roster" style={linkStyle}>學生名冊</Link>
              </div>
            ))}
          </section>

          <section style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>任課班級與科目</h3>
            {taught.length === 0 && <p style={{ fontSize: 12, color: '#999' }}>目前學年度沒有找到這位老師的任課資料。</p>}
            {taught.map(({ cls, subjects }) => (
              <div key={cls.id} style={{ border: '1px solid #e3e3e3', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <b>{classLabel(cls)}</b> <span style={{ color: '#777' }}>— {subjects.join('、')}</span>
                </div>
                <Link href={`/admin/grading?tab=entry&classId=${cls.id}`} style={linkStyle}>成績登錄／成績輸入表</Link>
                <Link href={`/attendance/weekly?classId=${cls.id}`} style={linkStyle}>出缺席登錄（一週）／輸入表</Link>
                <Link href="/attendance/subject-view" style={linkStyle}>任課班級出席查詢</Link>
              </div>
            ))}
          </section>

          <section style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>社團／才藝課</h3>
            {clubs.length === 0 && <p style={{ fontSize: 12, color: '#999' }}>沒有帶社團。</p>}
            {clubs.map((c) => (
              <div key={c.id} style={{ border: '1px solid #e3e3e3', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <b>{c.name}</b> <span style={{ color: '#777' }}>{c.academic_year} {c.term}</span>
                </div>
                <Link href="/clubs/roster" style={linkStyle}>社團點名冊</Link>
                <Link href="/clubs/grading" style={linkStyle}>社團成績輸入</Link>
              </div>
            ))}
          </section>
        </>
      )}

      <section style={{ borderTop: '1px solid #eee', paddingTop: 14 }}>
        <h3 style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>全校性的教師檔案上傳／下載（不用先選老師）</h3>
        <Link href="/admin/grading?tab=entry" style={linkStyle}>成績輸入表（全校各班下載／上傳）</Link>
        <Link href="/attendance/weekly" style={linkStyle}>出缺席輸入表（可下載全校一班一分頁）</Link>
        <Link href="/admin/grading?tab=class-summary" style={linkStyle}>班級成績總表下載</Link>
        <Link href="/admin/dev-tools#dept-excel" style={linkStyle}>四部門 Excel 一鍵下載／上傳（開發人員資料中心）</Link>
      </section>
    </main>
  );
}

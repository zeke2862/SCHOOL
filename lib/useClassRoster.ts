'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { resolveCurrentTerm } from '@/lib/academicTerm';
import { compareGradeClass } from '@/lib/schoolOrder';
import { getHiddenStudentNos } from '@/lib/hiddenStudents';
import { useCaps } from '@/lib/useCaps';
import { loadPhotoUrls, type PhotoMap } from '@/lib/studentPhotos';

// 「選一個班 → 列出這班在籍學生與照片」的共用邏輯（學生照片頁、班級座位表共用）。
// 班級清單只列目前學年；有導師班的老師預設選自己的班。

export type RosterClass = { id: string; label: string; homeroom_teacher_id: string | null };
export type RosterStudent = { student_no: string; name: string; gender: string | null; seat_no: number | null };

export function useClassRoster() {
  const { caps, loading: capsLoading } = useCaps();
  const [classes, setClasses] = useState<RosterClass[]>([]);
  const [classId, setClassId] = useState('');
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [photos, setPhotos] = useState<PhotoMap>({});
  const [photosAvailable, setPhotosAvailable] = useState(true);
  // 標記「不放照片」的學號（sql/153）；optOutAvailable=false 代表 sql/153 還沒執行，畫面不顯示這個功能
  const [optOut, setOptOut] = useState<Set<string>>(new Set());
  const [optOutAvailable, setOptOutAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const req = useRef(0);
  const teacherId = caps?.ident.teacherId ?? null;

  useEffect(() => {
    if (capsLoading) return;
    let alive = true;
    (async () => {
      const cur = await resolveCurrentTerm();
      let q = supabase.from('classes').select('id, academic_year, grade_level, class_name, homeroom_teacher_id');
      if (cur) q = q.eq('academic_year', cur.academic_year);
      const { data, error: err } = await q;
      if (!alive) return;
      if (err) {
        setError('讀取班級失敗：' + err.message);
        setLoading(false);
        return;
      }
      const list = ((data ?? []) as any[])
        .sort(compareGradeClass)
        .map((c) => ({ id: c.id, label: `${c.grade_level}${c.class_name}`, homeroom_teacher_id: c.homeroom_teacher_id as string | null }));
      setClasses(list);
      const mine = teacherId ? list.find((c) => c.homeroom_teacher_id === teacherId) : null;
      setClassId((prev) => prev || mine?.id || '');
      if (!mine) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [capsLoading, teacherId]);

  const reloadPhotos = useCallback(async (nos: string[]) => {
    const r = await loadPhotoUrls(nos);
    setPhotos(r.urls);
    setPhotosAvailable(r.available);
    setOptOut(new Set(r.optOut));
    setOptOutAvailable(r.optOutAvailable);
  }, []);

  const isAdminView = !!caps && (caps.academic || caps.discipline || caps.sd || caps.a);

  useEffect(() => {
    if (!classId) {
      setStudents([]);
      setPhotos({});
      return;
    }
    const id = ++req.current;
    setLoading(true);
    setError('');
    (async () => {
      const { data, error: err } = await supabase
        .from('enrollments')
        .select('student_no, seat_no, students(name, gender)')
        .eq('class_id', classId)
        .eq('is_current', true)
        .order('seat_no')
        .order('id');
      if (id !== req.current) return;
      if (err) {
        setError('讀取學生名單失敗：' + err.message);
        setLoading(false);
        return;
      }
      let rows: RosterStudent[] = ((data ?? []) as any[]).map((r) => ({ student_no: r.student_no, seat_no: r.seat_no, name: r.students?.name ?? '', gender: r.students?.gender ?? null }));
      // 休學／轉出等學生不列入（座號 900 以上是暫放號；教師視角再對照一次最新學籍狀態）
      rows = rows.filter((r) => (r.seat_no ?? 0) < 900);
      if (!isAdminView) {
        const hidden = await getHiddenStudentNos(rows.map((r) => r.student_no));
        if (id !== req.current) return;
        rows = rows.filter((r) => !hidden.has(r.student_no));
      }
      setStudents(rows);
      setLoading(false);
      await reloadPhotos(rows.map((r) => r.student_no));
    })();
  }, [classId, isAdminView, reloadPhotos]);

  const current = classes.find((c) => c.id === classId) ?? null;
  // 能不能改這個班（上傳照片、排座位）：教務處／管理員，或這個班的導師。資料庫權限會再把關一次。
  // 管理員與教務處用「帳號本身」的角色與部門判斷，跟資料庫規則一致：就算切到「教師畫面」預覽，
  // 系統管理員S／管理員A／教務處仍然可以改（caps.academic 在教師畫面會被歸零，不能用它）。
  const ident = caps?.ident;
  const adminWrite = !!ident && (ident.realRole === 'system_admin_s' || ident.realRole === 'admin_a' || ident.departments.some((d) => d.department === 'academic'));
  const canWrite = !!caps && !!current && (adminWrite || (!!teacherId && current.homeroom_teacher_id === teacherId && !caps.ident.acting));

  return { caps, classes, classId, setClassId, current, students, photos, photosAvailable, optOut, optOutAvailable, loading: loading || capsLoading, error, canWrite, reloadPhotos };
}

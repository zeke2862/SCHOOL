'use client';

import { useEffect, useState } from 'react';
import { getCurrentAppUser } from '@/lib/supabaseClient';
import TeacherLettersPanel from '@/components/dev-tools/TeacherLettersPanel';

// 【行政管理】→「聘書」：歷年教師資料、自聘教師聘書、當年教師聘書與列印
export default function TeacherLettersSection() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      setUserId((await getCurrentAppUser())?.id ?? null);
    })();
  }, []);
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>聘書（歷年教師資料／自聘教師聘書／當年教師聘書／列印）</h1>
      <p style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
        原本要開 Excel 用 VBA 巨集列印的「教師資料」，改成在這裡管理：可以下載範本、整批上傳、下載目前資料，也可以逐筆新增／編輯／刪除。
      </p>
      <TeacherLettersPanel userId={userId} />
    </main>
  );
}

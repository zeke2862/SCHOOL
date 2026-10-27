'use client';

import { useEffect, useState } from 'react';
import RolloverPanel, { TermRef, isSupportedRollover, previousTermOf } from '@/components/rollover/RolloverPanel';
import { resolveCurrentTerm } from '@/lib/academicTerm';

// 升級作業：把學生整批轉到新學期（座號重排；跨學年時升一年級）。
// 以前是前端一個學生一個學生查、寫，一千多人要等很久；現在在資料庫一次完成（sql/112_term_rollover.sql）。
// 日常流程不需要手動來這裡：到「學年學期管理」把新學期設為「目前生效」時，系統會直接問你要不要升級。
export default function PromotionPage() {
  const [src, setSrc] = useState<TermRef>({ year: new Date().getFullYear(), term: '上學期' });
  const [tgt, setTgt] = useState<TermRef>({ year: new Date().getFullYear(), term: '下學期' });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    resolveCurrentTerm().then((cur) => {
      if (cur) {
        const t = { year: cur.academic_year, term: cur.term };
        setTgt(t);
        setSrc(previousTermOf(t));
      }
      setReady(true);
    });
  }, []);

  const setSrcSmart = (s: TermRef) => {
    setSrc(s);
    setTgt(s.term === '上學期' ? { year: s.year, term: '下學期' } : { year: s.year + 1, term: '上學期' });
  };

  const sel: React.CSSProperties = { padding: 6 };
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>升級作業</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16, lineHeight: 1.7 }}>
        同學年「上學期 → 下學期」：學生留在原班，座號依學號重新排。「下學期 → 新學年上學期」：升一年級、座號重新排，最高年級可標記為畢業。
        已退學／畢業／肄業／轉學的學生不會升級；已經升級過的學生會自動略過，重複執行不會重複建立。
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <span>從</span>
        <input type="number" value={src.year} onChange={(e) => setSrcSmart({ ...src, year: Number(e.target.value) })} style={{ ...sel, width: 90 }} />
        <select value={src.term} onChange={(e) => setSrcSmart({ ...src, term: e.target.value })} style={sel}>
          <option value="上學期">上學期</option>
          <option value="下學期">下學期</option>
        </select>
        <span>升級到 {tgt.year} 學年度 {tgt.term}</span>
      </div>
      {ready && isSupportedRollover(src, tgt) && (
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
          <RolloverPanel src={src} tgt={tgt} />
        </div>
      )}
    </div>
  );
}

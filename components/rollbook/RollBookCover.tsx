'use client';

import type { CSSProperties } from 'react';

// 整學期點名冊封面（版面照學校原本 Excel「ปกเตี่ยนหมิงเช่อ」工作表：校徽、校名、校舍照片、
// 大字「點名冊」、敦品勵學／崇德養志，下方是學年度學期與班級／班主任／人數）
const KAI: CSSProperties = { fontFamily: "'標楷體','KaiTi','DFKai-SB','BiauKai',serif" };

const row: CSSProperties = { display: 'flex', borderBottom: '2.5px solid #000' };
const labelCell: CSSProperties = { width: '42mm', textAlign: 'center', borderRight: '2.5px solid #000', padding: '2mm 0', fontSize: '28pt', letterSpacing: '0.3em', paddingLeft: '0.3em' };
const valueCell: CSSProperties = { flex: 1, textAlign: 'center', padding: '2mm 0', fontSize: '28pt', fontWeight: 700 };

export default function RollBookCover({ termLine, className, teacher, count }: { termLine: string; className: string; teacher: string; count: number }) {
  return (
    <div className="rollbook-sheet rollbook-cover" style={{ ...KAI, justifyContent: 'space-between', alignItems: 'stretch' }}>
      {/* 校徽＋校名 */}
      <div style={{ position: 'relative', textAlign: 'center', minHeight: '44mm' }}>
        <img src="/rollbook/school-seal.png" alt="" style={{ position: 'absolute', left: 0, top: 0, width: '40mm', height: 'auto' }} />
        <div style={{ fontSize: '34pt', lineHeight: 1.25, paddingLeft: '38mm' }}>泰國清萊雲南會館附屬</div>
        <div style={{ fontSize: '58pt', fontWeight: 700, lineHeight: 1.15, paddingLeft: '38mm' }}>華雲學校</div>
      </div>

      {/* 敦品勵學／點名冊＋校舍／崇德養志 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, minHeight: 0 }}>
        <div style={{ writingMode: 'vertical-rl', fontSize: '44pt', letterSpacing: '0.25em', fontWeight: 700, width: '22mm', textAlign: 'center' }}>敦品勵學</div>
        <div style={{ position: 'relative', width: '140mm', textAlign: 'center' }}>
          <div
            style={{
              fontSize: '96pt',
              fontWeight: 700,
              color: '#0070C0',
              WebkitTextStroke: '3px #000',
              paintOrder: 'stroke fill',
              textShadow: '0 0 12px rgba(91,155,213,0.7)',
              lineHeight: 1.1,
              position: 'relative',
              zIndex: 2,
              marginBottom: '-10mm',
              letterSpacing: '0.05em',
            }}
          >
            點名冊
          </div>
          <div style={{ position: 'relative', width: '140mm', height: '98mm' }}>
            <img src="/rollbook/school-building-bg.png" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.22 }} />
            <img src="/rollbook/school-building.png" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </div>
        <div style={{ writingMode: 'vertical-rl', fontSize: '44pt', letterSpacing: '0.25em', fontWeight: 700, width: '22mm', textAlign: 'center' }}>崇德養志</div>
      </div>

      {/* 學年度學期＋班級資料 */}
      <div>
        <div style={{ textAlign: 'center', fontSize: '28pt', margin: '4mm 0' }}>{termLine}</div>
        <div style={{ width: '150mm', margin: '0 auto', border: '2.5px solid #000', borderBottom: 'none' }}>
          <div style={row}>
            <div style={labelCell}>班級</div>
            <div style={valueCell}>{className}</div>
          </div>
          <div style={row}>
            <div style={labelCell}>班主任</div>
            <div style={valueCell}>{teacher || ' '}</div>
          </div>
          <div style={row}>
            <div style={labelCell}>人數</div>
            <div style={valueCell}>{count} 人</div>
          </div>
        </div>
      </div>
    </div>
  );
}

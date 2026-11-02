'use client';

import CoverCanvas from './CoverCanvas';
import { CoverData, CoverLayout } from '@/lib/coverLayout';

// 整學期點名冊封面：版面（每個文字／圖片的位置與大小）來自「編輯封面」存的設定，
// 沒設定過就用預設（照學校原本 Excel「ปกเตี่ยนหมิงเช่อ」工作表的樣子）。
export default function RollBookCover({ layout, data }: { layout: CoverLayout; data: CoverData }) {
  return (
    <div className="rollbook-sheet rollbook-cover" style={{ display: 'block' }}>
      <CoverCanvas layout={layout} data={data} />
    </div>
  );
}

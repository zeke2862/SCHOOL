import { supabase } from '@/lib/supabaseClient';

// 班級點名冊封面的版面：一張 A4（可用範圍 200mm × 286.5mm，四邊各留 5mm）上的文字與圖片，
// 每個元素的位置、大小都用「公釐」，可以在「編輯封面」頁拖曳調整，存在資料庫（全校共用一份）。

export const COVER_W_MM = 200;
export const COVER_H_MM = 286.5;

export type CoverElement = {
  id: string;
  kind: 'text' | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  // 文字
  text?: string;
  fontPt?: number;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  vertical?: boolean;
  spacing?: number; // 字距，單位 0.01em
  strokePx?: number; // 外框線粗細
  strokeColor?: string;
  glow?: boolean;
  borderPx?: number; // 方框線
  // 圖片
  src?: string;
  opacity?: number;
  fit?: 'cover' | 'contain' | 'fill';
};

export type CoverLayout = { version: 1; elements: CoverElement[] };

export const BUILTIN_IMAGES: { label: string; src: string }[] = [
  { label: '校徽', src: '/rollbook/school-seal.png' },
  { label: '校舍（去背）', src: '/rollbook/school-building.png' },
  { label: '校舍（含天空）', src: '/rollbook/school-building-bg.png' },
];

// 可以放在文字裡的自動欄位，列印時換成各班的資料
export const COVER_TOKENS = ['{{學期}}', '{{班級}}', '{{班主任}}', '{{人數}}'] as const;

export const DEFAULT_COVER_LAYOUT: CoverLayout = {
  version: 1,
  elements: [
    { id: 'seal', kind: 'image', x: 0, y: 0, w: 40, h: 39, z: 1, src: '/rollbook/school-seal.png', fit: 'contain', opacity: 1 },
    { id: 'org', kind: 'text', x: 42, y: 2, w: 158, h: 14, z: 1, text: '泰國清萊雲南會館附屬', fontPt: 34, align: 'center', color: '#000000' },
    { id: 'school', kind: 'text', x: 42, y: 15, w: 158, h: 24, z: 1, text: '華雲學校', fontPt: 58, bold: true, align: 'center', color: '#000000' },
    { id: 'motto-l', kind: 'text', x: 0, y: 80, w: 24, h: 100, z: 1, text: '敦品勵學', fontPt: 44, bold: true, align: 'center', vertical: true, spacing: 25, color: '#000000' },
    { id: 'motto-r', kind: 'text', x: 176, y: 80, w: 24, h: 100, z: 1, text: '崇德養志', fontPt: 44, bold: true, align: 'center', vertical: true, spacing: 25, color: '#000000' },
    { id: 'bg', kind: 'image', x: 30, y: 92, w: 140, h: 98, z: 2, src: '/rollbook/school-building-bg.png', fit: 'cover', opacity: 0.22 },
    { id: 'building', kind: 'image', x: 30, y: 92, w: 140, h: 98, z: 3, src: '/rollbook/school-building.png', fit: 'cover', opacity: 1 },
    { id: 'title', kind: 'text', x: 25, y: 58, w: 150, h: 44, z: 5, text: '點名冊', fontPt: 96, bold: true, align: 'center', color: '#0070C0', strokePx: 3, strokeColor: '#000000', glow: true, spacing: 5 },
    { id: 'term', kind: 'text', x: 0, y: 205, w: 200, h: 14, z: 1, text: '{{學期}}', fontPt: 28, align: 'center', color: '#000000' },
    { id: 'l-class', kind: 'text', x: 25, y: 224, w: 42, h: 18, z: 1, text: '班級', fontPt: 28, align: 'center', spacing: 30, borderPx: 2.5, color: '#000000' },
    { id: 'v-class', kind: 'text', x: 67, y: 224, w: 108, h: 18, z: 1, text: '{{班級}}', fontPt: 28, bold: true, align: 'center', borderPx: 2.5, color: '#000000' },
    { id: 'l-teacher', kind: 'text', x: 25, y: 242, w: 42, h: 18, z: 1, text: '班主任', fontPt: 28, align: 'center', spacing: 30, borderPx: 2.5, color: '#000000' },
    { id: 'v-teacher', kind: 'text', x: 67, y: 242, w: 108, h: 18, z: 1, text: '{{班主任}}', fontPt: 28, bold: true, align: 'center', borderPx: 2.5, color: '#000000' },
    { id: 'l-count', kind: 'text', x: 25, y: 260, w: 42, h: 18, z: 1, text: '人數', fontPt: 28, align: 'center', spacing: 30, borderPx: 2.5, color: '#000000' },
    { id: 'v-count', kind: 'text', x: 67, y: 260, w: 108, h: 18, z: 1, text: '{{人數}} 人', fontPt: 28, bold: true, align: 'center', borderPx: 2.5, color: '#000000' },
  ],
};

export type CoverData = { term: string; className: string; teacher: string; count: number | string };

export function fillCoverTokens(text: string, d: CoverData) {
  return text
    .replace(/\{\{學期\}\}/g, d.term)
    .replace(/\{\{班級\}\}/g, d.className)
    .replace(/\{\{班主任\}\}/g, d.teacher)
    .replace(/\{\{人數\}\}/g, String(d.count));
}

function isLayout(v: any): v is CoverLayout {
  return v && v.version === 1 && Array.isArray(v.elements);
}

export async function loadCoverLayout(): Promise<CoverLayout> {
  try {
    const { data } = await supabase.from('rollbook_cover_layout').select('layout').eq('id', true).maybeSingle();
    if (data && isLayout((data as any).layout)) return (data as any).layout;
  } catch {
    // 讀不到就用預設版面
  }
  return DEFAULT_COVER_LAYOUT;
}

export async function saveCoverLayout(layout: CoverLayout, userId: string | null) {
  return supabase.from('rollbook_cover_layout').upsert({ id: true, layout, updated_by: userId, updated_at: new Date().toISOString() });
}

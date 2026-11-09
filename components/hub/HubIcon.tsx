// 首頁功能方塊的圓形圖示：用內建 emoji 文字，不載入任何圖檔（0 KB，不影響速度）。
// 底色用淡色，顏色只做「分類辨識」，不代表狀態（紅綠狀態色另外處理）。
const ICONS: Record<string, { e: string; bg: string }> = {
  attendance: { e: '✅', bg: '#E3F4EB' },
  grading: { e: '📝', bg: '#FFF3D1' },
  registrar: { e: '🎒', bg: '#E3EEFF' },
  rewards: { e: '🏅', bg: '#FFE6DD' },
  exam: { e: '🪑', bg: '#ECE7FF' },
  clubs: { e: '🎨', bg: '#FFE6F1' },
  rollbook: { e: '📋', bg: '#DDF5EA' },
  clock: { e: '⏰', bg: '#FFF3D1' },
  scheduling: { e: '📅', bg: '#E3EEFF' },
  letters: { e: '✉️', bg: '#FFE6DD' },
  review: { e: '🔍', bg: '#ECE7FF' },
  general: { e: '🔧', bg: '#DDF5EA' },
  system: { e: '⚙️', bg: '#EEF0F2' },
};
const FALLBACK = { e: '📌', bg: '#E3F4EB' };

export default function HubIcon({ hubKey, size = 36 }: { hubKey: string; size?: number }) {
  const ic = ICONS[hubKey] ?? FALLBACK;
  return (
    <span
      aria-hidden="true"
      className="no-print"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: ic.bg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.52),
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {ic.e}
    </span>
  );
}

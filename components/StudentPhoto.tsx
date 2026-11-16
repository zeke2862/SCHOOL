'use client';

// 學生大頭照（3:4）。沒有照片時顯示姓名第一個字的灰底框，版面大小不會跳動。
export default function StudentPhoto({ url, name, width = 60, title }: { url?: string | null; name?: string | null; width?: number; title?: string }) {
  const height = Math.round((width * 4) / 3);
  const box: React.CSSProperties = { width, height, flex: 'none', borderRadius: Math.max(4, Math.round(width / 10)), overflow: 'hidden', background: 'var(--primary-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  if (url) {
    return (
      <span style={box} title={title ?? name ?? undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name ? `${name}的照片` : '學生照片'} width={width} height={height} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </span>
    );
  }
  return (
    <span style={{ ...box, color: 'var(--sub)', fontSize: Math.max(11, Math.round(width * 0.4)), fontWeight: 700 }} title={title ?? (name ? `${name}（尚無照片）` : '尚無照片')} aria-label="尚無照片">
      {(name ?? '').trim().slice(0, 1) || '?'}
    </span>
  );
}

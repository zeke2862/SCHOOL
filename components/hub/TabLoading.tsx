// 功能分頁的程式還在下載時顯示的文字（各入口頁的 next/dynamic 共用）
export default function TabLoading() {
  return <p style={{ padding: 24, fontSize: 13, color: 'var(--sub)' }}>載入中…</p>;
}

// 換頁、載入頁面程式碼時顯示的等待畫面（取代慢網路時的一片空白）
export default function Loading() {
  return (
    <div role="status" aria-live="polite" style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--sub)', fontSize: 14 }}>
      載入中…
    </div>
  );
}

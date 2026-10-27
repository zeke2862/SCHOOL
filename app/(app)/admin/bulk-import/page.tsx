'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// 「整批下載／上傳」已經併入「開發人員資料中心」（四部門 Excel 一鍵下載／上傳），
// 這裡保留一個自動跳轉，舊的書籤或連結點進來不會壞掉。
// （原本這頁的「整體佔比與加扣分規則」「既有學生快速建檔」兩張表：
//   資料本身都包含在新版教務 Excel 的 grading_rules／students／enrollments 分頁裡；
//   「既有學生快速建檔」的精簡版仍可在【學籍設定及查詢 → 既有學生快速建檔】使用。）
export default function BulkImportRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/dev-tools#dept-excel');
  }, [router]);
  return <p style={{ padding: 24, fontSize: 13, color: '#999' }}>已併入「開發人員資料中心」，正在跳轉…</p>;
}

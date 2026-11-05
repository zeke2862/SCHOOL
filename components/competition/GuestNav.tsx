'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

// 賽事訪客（外聘評審/裁判）專用的簡化頂端列：只有「我的賽事」和登出，沒有校務系統的其他入口。
export default function GuestNav({ name }: { name: string }) {
  const router = useRouter();
  async function logout() {
    await supabase.auth.signOut();
    router.replace('/');
  }
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#fff', borderBottom: '1px solid #e5e5e5' }}>
      <Link href="/competitions" style={{ color: '#1f4e79', fontSize: 14 }}>競賽活動</Link>
      <span style={{ fontSize: 12, color: '#777' }}>外聘評審／裁判：{name}</span>
      <button onClick={logout} style={{ marginLeft: 'auto', padding: '4px 12px', border: '1px solid #bbb', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>登出</button>
    </nav>
  );
}

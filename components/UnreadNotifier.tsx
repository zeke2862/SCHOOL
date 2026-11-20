'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase, getCurrentTeacherId } from '@/lib/supabaseClient';
import { getGameMode } from '@/lib/gameMode';

// 未讀通知提醒：有新的通知（例如家長／學生帳號申請、考場名冊、審核）時，在畫面上跳出
// 「您有 N 則未讀通知」，一鍵前往處理；上方導覽列的「通知（N）」數字也會即時更新。
// 分頁顯示中每 120 秒、或切回這個分頁時查一次（背景分頁不查）；同一則通知每個瀏覽階段只跳出一次。

const TARGET_BY_CATEGORY: Record<string, { href: string; label: string }> = {
  審核通知: { href: '/review?tab=portal-requests', label: '家長／學生帳號申請' },
  請假申請: { href: '/review?tab=student-leave', label: '學生請假申請' },
  學籍異動申請: { href: '/review?tab=status-requests', label: '學籍異動申請' },
  學生資料變更: { href: '/review?tab=profile', label: '學生資料變更' },
  個資修改申請: { href: '/review?tab=profile', label: '個資修改申請' },
  考場通知: { href: '/exam-rosters', label: '考場名冊' },
};

type Unread = { id: string; category: string; created_at: string };

export default function UnreadNotifier() {
  const pathname = usePathname();
  const router = useRouter();
  const [toast, setToast] = useState<{ count: number; newest: Unread } | null>(null);
  const teacherRef = useRef<string | null | undefined>(undefined);

  async function check() {
    try {
      if (teacherRef.current === undefined) teacherRef.current = await getCurrentTeacherId();
      const tid = teacherRef.current;
      if (!tid) return;
      const { data, count } = await supabase
        .from('staff_notifications')
        .select('id, category, created_at', { count: 'exact' })
        .eq('teacher_id', tid)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      const total = count ?? (data?.length ?? 0);
      window.dispatchEvent(new CustomEvent('staff-unread-count', { detail: total }));
      const newest = (data ?? [])[0] as Unread | undefined;
      if (!newest || total === 0) {
        setToast(null);
        return;
      }
      // 比「這個瀏覽階段已提醒過的最新一則」更新才跳出
      let seen = '';
      try {
        seen = sessionStorage.getItem('unreadToastSeen') ?? '';
      } catch {
        /* 略過 */
      }
      if (newest.created_at > seen) {
        setToast({ count: total, newest });
        try {
          sessionStorage.setItem('unreadToastSeen', newest.created_at);
        } catch {
          /* 略過 */
        }
      }
    } catch {
      /* 查不到就不提醒，不影響使用 */
    }
  }

  useEffect(() => {
    // 資安與效能檢測報告 #12：分頁在背景（隱藏）時完全不查；顯示中每 120 秒查一次；
    // 切回分頁時立刻查，但 20 秒內剛查過就不重複查（來回切換分頁不會連續打資料庫）。
    let last = 0;
    const run = () => {
      last = Date.now();
      check();
    };
    run();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, 120_000);
    const onFocus = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 20_000) run();
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 進入通知頁就不用再跳提醒
  useEffect(() => {
    if (pathname?.startsWith('/notifications')) setToast(null);
  }, [pathname]);

  if (!toast) return null;
  const gm = getGameMode();
  const target = TARGET_BY_CATEGORY[toast.newest.category] ?? { href: '/notifications', label: toast.newest.category };
  return (
    <div
      className="no-print"
      role="status"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        left: 16,
        maxWidth: 420,
        marginLeft: 'auto',
        zIndex: 9999,
        background: 'var(--primary)',
        color: '#fff',
        borderRadius: 12,
        padding: '12px 14px',
        boxShadow: '0 6px 24px rgba(0,0,0,.25)',
        fontSize: 14,
        lineHeight: 1.6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          {gm === 'rpg' ? '📜 新任務出現！' : gm === 'idle' ? '🚶 有訪客來訪！' : '🔔 您有'} <b style={{ color: '#FFD166' }}>{toast.count}</b>{' '}
          {gm === 'rpg' ? '個任務等你接' : gm === 'idle' ? '位在大廳等你' : '則未讀通知'}
          <div style={{ fontSize: 12.5, color: '#ddd' }}>最新：{target.label}</div>
        </div>
        <button
          onClick={() => setToast(null)}
          aria-label="關閉提醒"
          className="keep-size"
          style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 18, minHeight: 0, alignSelf: 'flex-start' }}
        >
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          onClick={() => {
            setToast(null);
            router.push(target.href);
          }}
          className="keep-size"
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', background: '#FFD166', color: 'var(--ink)', fontWeight: 700, cursor: 'pointer', fontSize: 14, minHeight: 0 }}
        >
          前往處理
        </button>
        <button
          onClick={() => {
            setToast(null);
            router.push('/notifications');
          }}
          className="keep-size"
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #666', background: 'none', color: '#fff', cursor: 'pointer', fontSize: 14, minHeight: 0 }}
        >
          全部通知
        </button>
      </div>
    </div>
  );
}

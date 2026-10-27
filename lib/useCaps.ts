import { useEffect, useState } from 'react';
import { getMyIdentity } from '@/lib/supabaseClient';
import { Caps, computeCaps, readPreviewKind } from '@/lib/permissions';

/** 目前登入者的有效身分與權限（含代理期間、預覽教師畫面）。loading 期間 caps 為 null。 */
export function useCaps(): { caps: Caps | null; loading: boolean } {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const ident = await getMyIdentity();
      if (!active) return;
      if (!ident) {
        setCaps(null);
        setLoading(false);
        return;
      }
      const preview = typeof window !== 'undefined' && sessionStorage.getItem('viewMode') === 'teacher';
      setCaps(computeCaps(ident, preview, readPreviewKind()));
      setLoading(false);
    }
    load();
    const onChange = () => {
      load();
    };
    window.addEventListener('viewmode-change', onChange);
    window.addEventListener('acting-change', onChange);
    return () => {
      active = false;
      window.removeEventListener('viewmode-change', onChange);
      window.removeEventListener('acting-change', onChange);
    };
  }, []);

  return { caps, loading };
}

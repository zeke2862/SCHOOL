'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { CompEvent, CompGroup, CompItem, EVENT_STATUS_LABEL } from '@/lib/competitionScoring';
import SetupTab from '@/components/competition/SetupTab';
import RegistrationsTab from '@/components/competition/RegistrationsTab';
import StaffTab from '@/components/competition/StaffTab';
import ScoresTab from '@/components/competition/ScoresTab';
import PublicTab from '@/components/competition/PublicTab';
import { hint } from '@/components/competition/ui';

const TABS = [
  { key: 'setup', label: '① 賽事設定' },
  { key: 'regs', label: '② 報名名單' },
  { key: 'staff', label: '③ 評審與人員' },
  { key: 'scores', label: '④ 成績與公布' },
  { key: 'public', label: '⑤ 外校與公開頁' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

// 承辦人管理頁：只有這場賽事的承辦人（或系統管理員S）進得來。
export default function ManageCompetitionPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<CompEvent | null>(null);
  const [groups, setGroups] = useState<CompGroup[]>([]);
  const [items, setItems] = useState<CompItem[]>([]);
  const [myId, setMyId] = useState('');
  const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'missing'>('loading');
  const [tab, setTab] = useState<TabKey>('setup');

  const load = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id ?? '';
    setMyId(uid);
    const [ev, g, i, org, me] = await Promise.all([
      supabase.from('comp_events').select('*').eq('id', id).maybeSingle(),
      supabase.from('comp_groups').select('*').eq('event_id', id).order('sort_no'),
      supabase.from('comp_items').select('*').eq('event_id', id).order('sort_no'),
      supabase.from('comp_organizers').select('user_id').eq('event_id', id).eq('user_id', uid).maybeSingle(),
      supabase.from('app_users').select('role').eq('id', uid).maybeSingle(),
    ]);
    if (!ev.data) return setState('missing');
    if (!org.data && me.data?.role !== 'system_admin_s') return setState('denied');
    setEvent(ev.data as CompEvent);
    setGroups((g.data ?? []) as CompGroup[]);
    setItems((i.data ?? []) as CompItem[]);
    setState('ok');
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = window.location.hash.replace('#', '') as TabKey;
    if (TABS.some((t) => t.key === h)) setTab(h);
  }, []);
  const go = (k: TabKey) => { setTab(k); window.history.replaceState(null, '', `#${k}`); };

  if (state === 'loading') return <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}><p style={hint}>載入中…</p></main>;
  if (state !== 'ok' || !event) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 16 }}>賽事管理</h1>
        <p style={{ ...hint, marginTop: 8 }}>{state === 'denied' ? '只有這場賽事的承辦人可以進入管理頁。' : '找不到這場賽事。'}</p>
        <Link href="/competitions" style={{ color: 'var(--primary-ink)', fontSize: 13 }}>← 回賽事列表</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: 24 }}>
      <Link href="/competitions" style={{ color: 'var(--primary-ink)', fontSize: 12 }}>← 賽事列表</Link>
      <h1 style={{ fontSize: 16, margin: '4px 0' }}>{event.title}</h1>
      <p style={{ ...hint, marginBottom: 12 }}>目前狀態：{EVENT_STATUS_LABEL[event.status]}</p>
      <div role="tablist" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '2px solid var(--line)', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => go(t.key)}
            style={{ padding: '8px 14px', border: 0, borderBottom: tab === t.key ? '3px solid var(--primary)' : '3px solid transparent', background: 'none', cursor: 'pointer', fontWeight: tab === t.key ? 700 : 400, marginBottom: -2 }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'setup' && <SetupTab event={event} groups={groups} items={items} reload={load} />}
      {tab === 'regs' && <RegistrationsTab event={event} groups={groups} items={items} />}
      {tab === 'staff' && <StaffTab event={event} groups={groups} items={items} myId={myId} />}
      {tab === 'scores' && <ScoresTab event={event} groups={groups} items={items} reload={load} />}
      {tab === 'public' && <PublicTab event={event} />}
    </main>
  );
}

'use client';
import { useEffect, useState, useCallback } from 'react';
import { getMyIdentity, type MyIdentity } from '@/lib/supabaseClient';
import { listMyDelegations, listPeople, createDelegation, revokeDelegation, startActing, type DelegationRow, type PersonRow } from '@/lib/delegation';

const fmt = (s: string) => new Date(s).toLocaleString('zh-TW', { hour12: false });
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function DelegationManager() {
  const [ident, setIdent] = useState<MyIdentity | null>(null);
  const [rows, setRows] = useState<DelegationRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [principal, setPrincipal] = useState('');
  const [agent, setAgent] = useState('');
  const [start, setStart] = useState(toLocalInput(new Date()));
  const [end, setEnd] = useState(toLocalInput(new Date(Date.now() + 86400000)));
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const id = await getMyIdentity();
      setIdent(id);
      setRows(await listMyDelegations());
      const p = await listPeople();
      setPeople(p);
      if (id && !principal) setPrincipal(id.uid);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  }, [principal]);
  useEffect(() => { load(); }, [load]);

  const principals = people.filter((p) => p.can_be_principal);
  const agents = people.filter((p) => p.id !== principal);
  const regular = agents.filter((p) => !p.is_temporary);
  const temps = agents.filter((p) => p.is_temporary);

  async function submit() {
    if (!principal || !agent) { setMsg({ ok: false, text: '請選擇「被代理的人」和「代理人」' }); return; }
    setBusy(true); setMsg(null);
    try {
      await createDelegation(principal, agent, new Date(start).toISOString(), new Date(end).toISOString(), reason);
      setMsg({ ok: true, text: '設定完成！已通知代理人、本人與更高層級的主管。' });
      setReason(''); setAgent('');
      await load();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  }
  async function act(fn: () => Promise<void>, okText: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); await load(); } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  }

  const box: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 };
  const inp: React.CSSProperties = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, width: '100%', fontSize: 15 };
  const lbl: React.CSSProperties = { display: 'block', fontSize: 13, color: '#475569', margin: '10px 0 4px' };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: 16 }}>
      <h2 style={{ margin: '0 0 4px' }}>代理人設定</h2>
      <p style={{ color: '#64748b', marginTop: 0 }}>
        指定一個人、一段時間，這個人就可以暫時接手「被代理者」的一線教學工作：點名、輸入成績、平時表現（操行）等，使用對方的導師班與任課科目。時間一到自動結束，也可以隨時撤銷。
        代理「不包含」審核、核准與行政管理權限，行政職務如需有人接手，請由系統管理員S／A另行設定。你可以替自己設定；更高層級的主管也可以替下面的人設定（當事人無法操作時，系統才不會停擺）。
      </p>
      {msg && <div style={{ ...box, background: msg.ok ? '#ecfdf5' : '#fef2f2', borderColor: msg.ok ? '#6ee7b7' : '#fca5a5' }}>{msg.text}</div>}

      <div style={box}>
        <b>新增代理</b>
        <label style={lbl}>被代理的人（誰的權責要被借用）</label>
        <select style={inp} value={principal} onChange={(e) => setPrincipal(e.target.value)}>
          {principals.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === ident?.uid ? '（我自己）' : ''}</option>)}
        </select>
        <label style={lbl}>代理人（誰來暫時接手）</label>
        <select style={inp} value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">— 請選擇 —</option>
          <optgroup label="本校教職員">
            {regular.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
          {temps.length > 0 && (
            <optgroup label="臨時教師（外校支援）">
              {temps.map((p) => <option key={p.id} value={p.id}>{p.name}{p.home_org ? `（${p.home_org}）` : ''}</option>)}
            </optgroup>
          )}
        </select>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}><label style={lbl}>開始時間</label><input style={inp} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div style={{ flex: 1, minWidth: 200 }}><label style={lbl}>結束時間</label><input style={inp} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <label style={lbl}>原因（選填）</label>
        <input style={inp} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：出差、病假" />
        <button disabled={busy} onClick={submit} style={{ marginTop: 14, padding: '10px 20px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 8, fontSize: 15, cursor: 'pointer' }}>
          {busy ? '處理中…' : '設定代理'}
        </button>
        <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 0 }}>
          小提醒：臨時教師（外校支援）請先請教務處到「系統管理 → 臨時教師」建立帳號，建立後就會出現在代理人清單裡。
        </p>
      </div>

      <div style={box}>
        <b>代理紀錄</b>
        {rows.length === 0 && <p style={{ color: '#94a3b8' }}>目前沒有任何代理設定。</p>}
        {rows.map((r) => (
          <div key={r.id} style={{ borderTop: '1px solid #f1f5f9', padding: '10px 0' }}>
            <div>
              <b>{r.agent_name}</b> 代理 <b>{r.principal_name}</b>
              <span style={{ marginLeft: 8, fontSize: 12, padding: '2px 8px', borderRadius: 99, background: r.status !== 'active' ? '#f1f5f9' : r.is_active ? '#dcfce7' : '#fef9c3' }}>
                {r.status === 'revoked' ? '已撤銷' : r.status !== 'active' ? r.status : r.is_active ? '進行中' : new Date(r.end_at) < new Date() ? '已結束' : '尚未開始'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{fmt(r.start_at)} ～ {fmt(r.end_at)}{r.reason ? `｜${r.reason}` : ''}｜設定者：{r.set_by_name ?? '—'}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              {r.i_am_agent && r.is_active && <button disabled={busy} onClick={() => act(() => startActing(r.principal_user_id), '已開始代理，右上角可以結束。')} style={{ padding: '4px 12px' }}>開始代理</button>}
              {r.can_revoke && <button disabled={busy} onClick={() => act(() => revokeDelegation(r.id), '已撤銷')} style={{ padding: '4px 12px', color: '#b91c1c' }}>撤銷</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

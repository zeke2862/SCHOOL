'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = { id: number; table_name: string; op: string; row_id: string | null; old_row: any; new_row: any; actor_user_id: string | null; acting_for_user_id: string | null; changed_at: string };
const OP: Record<string, string> = { INSERT: '新增', UPDATE: '修改', DELETE: '刪除' };

export default function ChangeAuditPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [table, setTable] = useState('');
  const [tables, setTables] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      let q = supabase.from('change_audit_log').select('*').order('changed_at', { ascending: false }).limit(300);
      if (table) q = q.eq('table_name', table);
      const { data, error } = await q;
      if (error) { setErr(error.message); return; }
      const r = (data ?? []) as Row[];
      setRows(r);
      if (!table) setTables(Array.from(new Set(r.map((x) => x.table_name))).sort());
      const ids = Array.from(new Set(r.flatMap((x) => [x.actor_user_id, x.acting_for_user_id]).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: u } = await supabase.from('app_users').select('id, name').in('id', ids);
        setNames(Object.fromEntries((u ?? []).map((x: any) => [x.id, x.name])));
      }
    })();
  }, [table]);

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>全系統異動紀錄</h2>
      <p style={{ color: '#64748b' }}>所有「修改／刪除」都會留下紀錄（第一次登錄成績、出缺席不記）。代理期間的操作會標示「代理誰」。</p>
      <select value={table} onChange={(e) => setTable(e.target.value)} style={{ padding: 6, marginBottom: 10 }}>
        <option value="">全部資料表</option>
        {tables.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {err && <div style={{ color: '#b91c1c' }}>{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ textAlign: 'left', background: '#f8fafc' }}><th style={{ padding: 6 }}>時間</th><th>操作人</th><th>代理</th><th>資料表</th><th>動作</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <>
                <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{new Date(r.changed_at).toLocaleString('zh-TW', { hour12: false })}</td>
                  <td>{r.actor_user_id ? names[r.actor_user_id] ?? '—' : '系統'}</td>
                  <td>{r.acting_for_user_id ? names[r.acting_for_user_id] ?? '—' : ''}</td>
                  <td>{r.table_name}</td>
                  <td>{OP[r.op] ?? r.op}</td>
                  <td><button onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? '收起' : '內容'}</button></td>
                </tr>
                {open === r.id && (
                  <tr key={r.id + 'd'}><td colSpan={6}><pre style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 8, fontSize: 12 }}>{'修改前：' + JSON.stringify(r.old_row, null, 1) + '\n修改後：' + JSON.stringify(r.new_row, null, 1)}</pre></td></tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

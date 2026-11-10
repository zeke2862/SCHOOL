'use client';

import { useState } from 'react';
import { DaySummary, DayStatus, RangeStats, STATUS_COLOR, WEEKDAY_LABEL, fmtHours, shiftMonth } from '@/lib/staffClock';
import type { ClockTerm } from '@/lib/staffClockData';

export const th: React.CSSProperties = { padding: '6px 8px', borderBottom: '2px solid var(--line-strong)', textAlign: 'left', whiteSpace: 'nowrap', background: 'var(--primary-soft)' };
export const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' };
export const btn: React.CSSProperties = { padding: '6px 12px', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', fontSize: 13 };
export const btnPrimary: React.CSSProperties = { ...btn, background: 'var(--primary)', color: '#fff', border: '1px solid var(--primary)' };
export const input: React.CSSProperties = { padding: '5px 8px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 13 };

export function StatusBadge({ status }: { status: DayStatus }) {
  const c = STATUS_COLOR[status];
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 10, fontSize: 12, whiteSpace: 'nowrap' }}>{status}</span>
  );
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (ym: string) => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button style={btn} onClick={() => onChange(shiftMonth(value, -1))}>
        ◀
      </button>
      <input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} style={input} />
      <button style={btn} onClick={() => onChange(shiftMonth(value, 1))}>
        ▶
      </button>
    </span>
  );
}

/** 學期／學年下拉選單（依「學年學期設定」，新的在前；目前的加註） */
export function TermPicker({
  terms,
  value,
  onChange,
  currentLabel = '本學期',
}: {
  terms: Pick<ClockTerm, 'key' | 'label' | 'from' | 'to' | 'isCurrent'>[];
  value: string;
  onChange: (key: string) => void;
  currentLabel?: string;
}) {
  if (terms.length === 0) return <span style={{ fontSize: 13, color: '#b26a00' }}>尚未建立學年學期（請到「學年學期設定」新增）</span>;
  const cur = terms.find((t) => t.key === value);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={input}>
        {terms.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
            {t.isCurrent ? `（${currentLabel}）` : ''}
          </option>
        ))}
      </select>
      {cur && (
        <span style={{ fontSize: 12, color: 'var(--sub)' }}>
          {cur.from} ～ {cur.to}
        </span>
      )}
    </span>
  );
}

type PickKey = '遲到' | '早退' | '漏打卡' | '缺勤' | '請假' | '公出';
const PICKABLE: PickKey[] = ['遲到', '早退', '漏打卡', '缺勤', '請假', '公出'];

/** 點選統計卡片時，哪些日子算「有這項紀錄」（與 summarizeRange 的計數規則一致） */
function matchesPick(d: DaySummary, k: PickKey): boolean {
  if (k === '公出') return d.status === '公出';
  if (k === '請假') return d.status === '請假';
  if (!d.expected) return false;
  if (k === '遲到') return d.status === '遲到' || d.status === '遲到早退';
  if (k === '早退') return d.status === '早退' || d.status === '遲到早退';
  return d.status === k;
}

export function StatsCards({ stats, picked, onPick }: { stats: RangeStats; picked?: string | null; onPick?: (label: string | null) => void }) {
  const items: { label: string; value: string | number; warn?: boolean }[] = [
    { label: '應到天數', value: stats.expectedDays },
    { label: '正常', value: stats.normal },
    { label: '遲到', value: stats.late, warn: stats.late > 0 },
    { label: '早退', value: stats.early, warn: stats.early > 0 },
    { label: '漏打卡', value: stats.missing, warn: stats.missing > 0 },
    { label: '缺勤', value: stats.absent, warn: stats.absent > 0 },
    { label: '請假', value: stats.leave },
    { label: '公出', value: stats.official },
    { label: '遲到合計', value: `${stats.lateMinutes} 分`, warn: stats.lateMinutes > 0 },
    { label: '在校時數', value: fmtHours(stats.workedMinutes) },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
      {items.map((it) => {
        const clickable = !!onPick && (PICKABLE as string[]).includes(it.label);
        const on = picked === it.label;
        return (
          <div
            key={it.label}
            onClick={clickable ? () => onPick!(on ? null : it.label) : undefined}
            title={clickable ? '點一下只看這項的日期' : undefined}
            style={{
              border: on ? '2px solid var(--primary)' : '1px solid var(--line)',
              borderRadius: 8,
              padding: on ? '7px 11px' : '8px 12px',
              minWidth: 78,
              background: it.warn ? '#fff8f0' : 'var(--surface)',
              cursor: clickable ? 'pointer' : undefined,
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--sub)' }}>{it.label}{clickable ? ' ▾' : ''}</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: it.warn ? '#c2410c' : 'var(--ink)' }}>{it.value}</div>
          </div>
        );
      })}
    </div>
  );
}

/** 統計卡片＋每日明細：點卡片（遲到／早退／漏打卡／缺勤／請假／公出）就列出有該紀錄的日期 */
export function StatsWithDays({ stats, days, initialPick }: { stats: RangeStats; days: DaySummary[]; initialPick?: string | null }) {
  const [picked, setPicked] = useState<string | null>(initialPick ?? null);
  const hit = picked ? days.filter((d) => matchesPick(d, picked as PickKey)) : null;
  return (
    <>
      <StatsCards stats={stats} picked={picked} onPick={setPicked} />
      {hit && (
        <p style={{ fontSize: 13, margin: '0 0 8px' }}>
          <b>{picked}</b>：{hit.length ? `${hit.length} 天（${hit.map((d) => d.date.slice(5).replace('-', '/')).join('、')}）` : '這段期間沒有紀錄'}
          　<button style={{ ...btn, padding: '2px 8px', fontSize: 12 }} onClick={() => setPicked(null)}>顯示全部</button>
        </p>
      )}
      <DayTable days={hit ?? days} hideEmptyOffDays={!hit} />
    </>
  );
}

/** 每日明細表：上班/下班取自「班別時段內」的第一筆與最後一筆打卡，其餘打卡列在「全部打卡」 */
export function DayTable({ days, hideEmptyOffDays }: { days: DaySummary[]; hideEmptyOffDays?: boolean }) {
  const list = hideEmptyOffDays ? days.filter((d) => !(d.status === '非排班日' && d.punches.length === 0)) : days;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th}>日期</th>
            <th style={th}>星期</th>
            <th style={th}>班別</th>
            <th style={th}>上班</th>
            <th style={th}>下班</th>
            <th style={th}>狀態</th>
            <th style={th}>全部打卡</th>
            <th style={th}>備註</th>
          </tr>
        </thead>
        <tbody>
          {list.map((d) => (
            <tr key={d.date} style={{ background: d.weekday >= 6 ? '#fcfcfc' : undefined }}>
              <td style={td}>{d.date.slice(5).replace('-', '/')}</td>
              <td style={{ ...td, color: d.weekday === 7 ? '#c00' : undefined }}>{WEEKDAY_LABEL[d.weekday]}</td>
              <td style={{ ...td, color: 'var(--sub)' }}>{d.shiftLabel || '—'}</td>
              <td style={td}>{d.inTime ?? '—'}</td>
              <td style={td}>{d.outTime ?? '—'}</td>
              <td style={td}>
                <StatusBadge status={d.status} />
              </td>
              <td style={{ ...td, color: 'var(--sub)' }}>{d.punches.join('、') || '—'}</td>
              <td style={{ ...td, color: 'var(--sub)' }}>{d.note}</td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td style={{ ...td, color: 'var(--sub)' }} colSpan={8}>
                這個月沒有資料
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import { useState } from 'react';

const OTHER = '__other__';

/**
 * 授課位置選擇：列出班級教室，最後一項「其它」會開啟輸入框自行輸入（例如「活動中心」「操場」）。
 * value 是最後要存的文字；目前的值不在選項裡（例如舊資料「活動中心」）時自動切到「其它」並帶入。
 */
export default function LocationPicker({ value, options, onChange, disabled }: { value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  const [otherMode, setOtherMode] = useState(!!value && !options.includes(value));
  const selectValue = otherMode ? OTHER : value;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <select
        value={selectValue}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setOtherMode(true);
            onChange('');
          } else {
            setOtherMode(false);
            onChange(e.target.value);
          }
        }}
        style={{ width: '100%', padding: 6 }}
      >
        <option value="">（尚未指定）</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={OTHER}>其它（自行輸入）</option>
      </select>
      {otherMode && (
        <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="輸入授課位置，例如：活動中心" style={{ width: '100%', padding: 6 }} />
      )}
    </span>
  );
}

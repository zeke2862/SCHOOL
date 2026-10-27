'use client';

// 名冊頁面的「查看學期」：預設本學期；要看上一個學期的成績／名冊就切到另一個學期。
export default function TermViewSelect(props: { value: string; onChange: (v: string) => void; style?: React.CSSProperties }) {
  const { value, onChange, style } = props;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={style} title="查看哪一個學期的名冊與成績">
      <option value="">本學期（預設）</option>
      <option value="上學期">上學期</option>
      <option value="下學期">下學期</option>
    </select>
  );
}

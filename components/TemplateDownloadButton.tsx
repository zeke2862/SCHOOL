'use client';

export default function TemplateDownloadButton({
  label = '下載 Excel 範本',
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px',
        background: 'var(--surface)',
        color: 'var(--primary-ink)',
        border: '1px solid var(--primary)',
        borderRadius: 6,
        fontSize: 13,
        cursor: 'pointer',
        marginBottom: 8,
      }}
    >
      ↓ {label}
    </button>
  );
}

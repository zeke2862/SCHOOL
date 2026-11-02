'use client';

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import CoverCanvas from './CoverCanvas';
import { getCurrentAppUser } from '@/lib/supabaseClient';
import {
  BUILTIN_IMAGES,
  COVER_H_MM,
  COVER_TOKENS,
  COVER_W_MM,
  CoverElement,
  CoverLayout,
  DEFAULT_COVER_LAYOUT,
  loadCoverLayout,
  saveCoverLayout,
} from '@/lib/coverLayout';

const SCALE = 0.85; // 編輯畫面的縮放（1mm ≈ 3.78px × 0.85）
const PX_PER_MM = 3.7795 * SCALE;
const SAMPLE = { term: '佛曆 2569 (2026) 學年度　下　學期', className: '幼乙愛班', teacher: '何玉煥', count: 45 };

const snap = (v: number) => Math.round(v * 2) / 2; // 0.5mm 為單位

export default function CoverEditor() {
  const [layout, setLayout] = useState<CoverLayout | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCoverLayout().then(setLayout);
  }, []);

  function update(id: string, patch: Partial<CoverElement>) {
    setLayout((prev) => (prev ? { ...prev, elements: prev.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) } : prev));
    setDirty(true);
    setMsg(null);
  }

  function onPointerDown(e: ReactPointerEvent, el: CoverElement, mode: 'move' | 'resize') {
    e.preventDefault();
    setSelectedId(el.id);
    drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h };
    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (ev.clientX - d.sx) / PX_PER_MM;
      const dy = (ev.clientY - d.sy) / PX_PER_MM;
      if (d.mode === 'move') update(d.id, { x: snap(d.ox + dx), y: snap(d.oy + dy) });
      else update(d.id, { w: Math.max(3, snap(d.ow + dx)), h: Math.max(3, snap(d.oh + dy)) });
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const selected = layout?.elements.find((e) => e.id === selectedId) ?? null;
  const maxZ = layout ? Math.max(0, ...layout.elements.map((e) => e.z)) : 0;

  function addText() {
    if (!layout) return;
    const id = 't' + Date.now();
    setLayout({ ...layout, elements: [...layout.elements, { id, kind: 'text', x: 60, y: 120, w: 80, h: 16, z: maxZ + 1, text: '新文字', fontPt: 24, align: 'center', color: '#000000' }] });
    setSelectedId(id);
    setDirty(true);
  }

  function readImageFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1200;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('讀不到這張圖片'));
      img.src = url;
    });
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !layout) return;
    try {
      const src = await readImageFile(f);
      if (selected?.kind === 'image') {
        update(selected.id, { src });
      } else {
        const id = 'i' + Date.now();
        setLayout({ ...layout, elements: [...layout.elements, { id, kind: 'image', x: 50, y: 100, w: 60, h: 45, z: maxZ + 1, src, fit: 'contain', opacity: 1 }] });
        setSelectedId(id);
        setDirty(true);
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    }
  }

  function addBuiltinImage(src: string) {
    if (!layout) return;
    const id = 'i' + Date.now();
    setLayout({ ...layout, elements: [...layout.elements, { id, kind: 'image', x: 50, y: 100, w: 60, h: 45, z: maxZ + 1, src, fit: 'contain', opacity: 1 }] });
    setSelectedId(id);
    setDirty(true);
  }

  function removeSelected() {
    if (!layout || !selected) return;
    setLayout({ ...layout, elements: layout.elements.filter((e) => e.id !== selected.id) });
    setSelectedId(null);
    setDirty(true);
  }

  function duplicateSelected() {
    if (!layout || !selected) return;
    const id = 'd' + Date.now();
    setLayout({ ...layout, elements: [...layout.elements, { ...selected, id, x: selected.x + 5, y: selected.y + 5, z: maxZ + 1 }] });
    setSelectedId(id);
    setDirty(true);
  }

  async function save() {
    if (!layout) return;
    setSaving(true);
    const me = await getCurrentAppUser();
    const { error } = await saveCoverLayout(layout, me?.id ?? null);
    setSaving(false);
    if (error) setMsg({ ok: false, text: '儲存失敗：' + error.message + '（只有系統管理員或教務處可以儲存）' });
    else {
      setDirty(false);
      setMsg({ ok: true, text: '已儲存，之後列印整學期點名冊的封面就會用這個版面。' });
    }
  }

  function resetDefault() {
    if (!window.confirm('確定要還原成預設版面嗎？（按「儲存」之後才會正式生效）')) return;
    setLayout(DEFAULT_COVER_LAYOUT);
    setSelectedId(null);
    setDirty(true);
  }

  if (!layout) return <p style={{ padding: 24, fontSize: 13, color: '#999' }}>載入中…</p>;

  const field = (label: string, node: React.ReactNode) => (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6 }}>
      <span style={{ color: '#555' }}>{label}</span>
      {node}
    </label>
  );
  const num = (v: number | undefined, on: (n: number) => void, step = 0.5, w = 70) => (
    <input type="number" step={step} value={v ?? 0} onChange={(e) => on(Number(e.target.value))} style={{ width: w, padding: 3 }} />
  );

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>編輯點名冊封面</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
        點一下文字或圖片選取，拖曳移動，拖右下角藍色小方塊調整大小；右邊可以改文字、字級、顏色、圖片…。文字裡的 {COVER_TOKENS.join('、')} 會在列印時換成各班的資料。按「儲存」後，全校整學期點名冊的封面都會套用。
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" onClick={addText} style={{ padding: '5px 12px' }}>＋文字</button>
        <button type="button" onClick={() => fileRef.current?.click()} style={{ padding: '5px 12px' }}>＋上傳圖片{selected?.kind === 'image' ? '（取代選取的圖）' : ''}</button>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) addBuiltinImage(e.target.value);
          }}
          style={{ padding: 5 }}
        >
          <option value="">＋加入內建圖片…</option>
          {BUILTIN_IMAGES.map((b) => (
            <option key={b.src} value={b.src}>
              {b.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={duplicateSelected} disabled={!selected} style={{ padding: '5px 12px' }}>複製</button>
        <button type="button" onClick={removeSelected} disabled={!selected} style={{ padding: '5px 12px', color: '#A32D2D' }}>刪除</button>
        <button type="button" onClick={resetDefault} style={{ padding: '5px 12px' }}>還原預設</button>
        <button type="button" onClick={save} disabled={saving || !dirty} style={{ padding: '5px 20px', fontWeight: 700 }}>
          {saving ? '儲存中…' : dirty ? '儲存' : '已儲存'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} style={{ display: 'none' }} />
      </div>
      {msg && <p style={{ fontSize: 13, color: msg.ok ? '#2D7A3A' : '#A32D2D', marginBottom: 8 }}>{msg.text}</p>}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* A4 畫布：外框是紙張邊緣（四邊各 5mm 是不可印區），裡面是可印範圍 */}
        <div style={{ background: '#fff', boxShadow: '0 1px 8px rgba(0,0,0,0.18)', padding: `${5 * PX_PER_MM}px`, flexShrink: 0 }}>
          <div
            style={{ width: COVER_W_MM * PX_PER_MM, height: COVER_H_MM * PX_PER_MM, position: 'relative', outline: '1px solid #ddd' }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null);
            }}
          >
            <div style={{ width: `${COVER_W_MM}mm`, height: `${COVER_H_MM}mm`, transform: `scale(${SCALE})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
              <div style={{ width: '100%', height: '100%', pointerEvents: 'auto' }}>
                <CoverCanvas layout={layout} data={SAMPLE} interactive={{ selectedId, onPointerDown }} />
              </div>
            </div>
          </div>
        </div>

        {/* 屬性面板 */}
        <div style={{ flex: 1, minWidth: 280, maxWidth: 420, border: '1px solid #eee', borderRadius: 8, padding: 12, background: '#fff' }}>
          {!selected ? (
            <p style={{ fontSize: 13, color: '#999' }}>請先點選左邊的文字或圖片。</p>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{selected.kind === 'text' ? '文字' : '圖片'}（單位：公釐）</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                {field('左 X', num(selected.x, (n) => update(selected.id, { x: n })))}
                {field('上 Y', num(selected.y, (n) => update(selected.id, { y: n })))}
                {field('寬', num(selected.w, (n) => update(selected.id, { w: Math.max(3, n) })))}
                {field('高', num(selected.h, (n) => update(selected.id, { h: Math.max(3, n) })))}
              </div>
              {field(
                '層次（大的在上面）',
                <span>
                  <button type="button" onClick={() => update(selected.id, { z: selected.z - 1 })} style={{ padding: '1px 8px' }}>－</button> {selected.z}{' '}
                  <button type="button" onClick={() => update(selected.id, { z: selected.z + 1 })} style={{ padding: '1px 8px' }}>＋</button>
                </span>
              )}

              {selected.kind === 'text' ? (
                <>
                  <textarea
                    value={selected.text ?? ''}
                    onChange={(e) => update(selected.id, { text: e.target.value })}
                    rows={3}
                    style={{ width: '100%', padding: 6, marginBottom: 4, boxSizing: 'border-box', fontSize: 14 }}
                  />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {COVER_TOKENS.map((t) => (
                      <button key={t} type="button" onClick={() => update(selected.id, { text: (selected.text ?? '') + t })} style={{ padding: '1px 8px', fontSize: 12 }}>
                        ＋{t}
                      </button>
                    ))}
                  </div>
                  {field('字級（pt）', num(selected.fontPt, (n) => update(selected.id, { fontPt: Math.max(4, n) }), 1))}
                  {field('顏色', <input type="color" value={selected.color ?? '#000000'} onChange={(e) => update(selected.id, { color: e.target.value })} />)}
                  {field(
                    '粗體',
                    <input type="checkbox" checked={!!selected.bold} onChange={(e) => update(selected.id, { bold: e.target.checked })} />
                  )}
                  {field(
                    '對齊',
                    <select value={selected.align ?? 'center'} onChange={(e) => update(selected.id, { align: e.target.value as any })}>
                      <option value="left">靠左</option>
                      <option value="center">置中</option>
                      <option value="right">靠右</option>
                    </select>
                  )}
                  {field('直排', <input type="checkbox" checked={!!selected.vertical} onChange={(e) => update(selected.id, { vertical: e.target.checked })} />)}
                  {field('字距（0.01 字）', num(selected.spacing, (n) => update(selected.id, { spacing: n }), 1))}
                  {field('文字外框線（px）', num(selected.strokePx, (n) => update(selected.id, { strokePx: Math.max(0, n) }), 0.5))}
                  {field('外框線顏色', <input type="color" value={selected.strokeColor ?? '#000000'} onChange={(e) => update(selected.id, { strokeColor: e.target.value })} />)}
                  {field('光暈', <input type="checkbox" checked={!!selected.glow} onChange={(e) => update(selected.id, { glow: e.target.checked })} />)}
                  {field('方框線（px，0＝無）', num(selected.borderPx, (n) => update(selected.id, { borderPx: Math.max(0, n) }), 0.5))}
                </>
              ) : (
                <>
                  {field(
                    '圖片來源',
                    <select
                      value={BUILTIN_IMAGES.some((b) => b.src === selected.src) ? selected.src : ''}
                      onChange={(e) => e.target.value && update(selected.id, { src: e.target.value })}
                    >
                      <option value="">（自行上傳的圖片）</option>
                      {BUILTIN_IMAGES.map((b) => (
                        <option key={b.src} value={b.src}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" onClick={() => fileRef.current?.click()} style={{ padding: '3px 10px', marginBottom: 8 }}>上傳新圖片取代</button>
                  {field('透明度（0～1）', num(selected.opacity ?? 1, (n) => update(selected.id, { opacity: Math.min(1, Math.max(0, n)) }), 0.05))}
                  {field(
                    '填滿方式',
                    <select value={selected.fit ?? 'cover'} onChange={(e) => update(selected.id, { fit: e.target.value as any })}>
                      <option value="cover">填滿（可能裁切）</option>
                      <option value="contain">完整顯示</option>
                      <option value="fill">拉伸</option>
                    </select>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

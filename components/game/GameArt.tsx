'use client';

import { useState, type ReactNode } from 'react';

// 遊戲面板用的插圖。
//   1. 優先用 public/game 裡的 WebP 圖（Canva 繪製，每張約 10KB、透明背景，共 35 張）。
//      只有顯示面板的人才會載入，而且用到哪張才載哪張（lazy）；原始面板完全不載。
//   2. 圖片載入失敗（檔案不見、網路不通）時，自動退回下面這組行內 SVG，畫面不會破圖。
// SVG 的 viewBox 統一是 100 x 100。

function ArtImg({ file, size, scale = 1, alt, fallback, filter }: { file: string; size: number; scale?: number; alt: string; fallback: ReactNode; filter?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  const w = Math.round(size * scale);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', justifyContent: 'center', width: size, height: size, lineHeight: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/game/${file}.webp`} width={w} height={w} alt={alt} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} style={{ display: 'block', filter }} />
    </span>
  );
}

export function PetArt(p: { species: string; stage: number; sleepy?: boolean; size?: number }) {
  const size = p.size ?? 64;
  const scale = [0.78, 0.66, 0.84, 1][Math.max(0, Math.min(3, p.stage))];
  return (
    <ArtImg
      file={p.stage <= 0 ? 'pet-egg' : `pet-${p.species}-${Math.min(3, p.stage)}`}
      size={size}
      scale={scale}
      alt={p.stage <= 0 ? '蛋' : '寵物'}
      filter={p.sleepy ? 'saturate(0.55) brightness(0.97)' : undefined}
      fallback={<PetSvg {...p} />}
    />
  );
}

export function PlantArt(p: { plant: string; progress: number; size?: number }) {
  const size = p.size ?? 64;
  if (p.plant === 'none') return <PlantSvg {...p} />;
  const st = p.progress >= 1 ? 4 : p.progress >= 0.75 ? 3 : p.progress >= 0.5 ? 2 : p.progress >= 0.25 ? 1 : 0;
  const file = st === 0 ? 'plant-sprout' : st === 1 ? 'plant-leaf' : st === 2 ? 'plant-bud' : `plant-${p.plant}-${st === 3 ? 'flower' : 'fruit'}`;
  return <ArtImg file={file} size={size} alt="植物" fallback={<PlantSvg {...p} />} />;
}

const INK = '#3B2F2A';
const BLUSH = '#FF9FB0';

// ---------------- 寵物 ----------------
type PetDef = { body: string; belly?: string };
const PET: Record<string, PetDef> = {
  chick: { body: '#FFD84D', belly: '#FFE98F' },
  cat: { body: '#F4A259', belly: '#FFD9AE' },
  dog: { body: '#D9A66B', belly: '#F2D6B0' },
  rabbit: { body: '#F7F2EF', belly: '#FFFFFF' },
  fox: { body: '#EA7A2F', belly: '#FFF3E6' },
  panda: { body: '#FFFFFF', belly: '#FFFFFF' },
  unicorn: { body: '#FFFFFF', belly: '#FFF0FA' },
};

function Eyes({ sleepy, panda }: { sleepy: boolean; panda: boolean }) {
  const ys = 54;
  if (sleepy) {
    return (
      <g stroke={INK} strokeWidth="2.4" strokeLinecap="round" fill="none">
        <path d={`M34 ${ys} q6 5 12 0`} />
        <path d={`M54 ${ys} q6 5 12 0`} />
      </g>
    );
  }
  return (
    <g>
      {panda && (
        <>
          <ellipse cx="39" cy={ys} rx="8" ry="10" fill={INK} transform={`rotate(20 39 ${ys})`} />
          <ellipse cx="61" cy={ys} rx="8" ry="10" fill={INK} transform={`rotate(-20 61 ${ys})`} />
        </>
      )}
      <circle cx="40" cy={ys} r="4.6" fill={panda ? '#fff' : INK} />
      <circle cx="60" cy={ys} r="4.6" fill={panda ? '#fff' : INK} />
      <circle cx="40" cy={ys} r={panda ? 2.6 : 0} fill={INK} />
      <circle cx="60" cy={ys} r={panda ? 2.6 : 0} fill={INK} />
      {!panda && (
        <>
          <circle cx="41.6" cy={ys - 1.8} r="1.5" fill="#fff" />
          <circle cx="61.6" cy={ys - 1.8} r="1.5" fill="#fff" />
        </>
      )}
    </g>
  );
}

function Crown() {
  return (
    <g transform="translate(50 17)">
      <path d="M-13 8 L-15 -6 L-7 0 L0 -9 L7 0 L15 -6 L13 8 Z" fill="#FFC928" stroke="#D99A00" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="0" cy="-9" r="2.4" fill="#FF6B8A" />
      <circle cx="-15" cy="-6" r="2" fill="#6FB7FF" />
      <circle cx="15" cy="-6" r="2" fill="#6FB7FF" />
    </g>
  );
}

function Sparkle({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z" fill="#FFC928" />;
}

function PetBack({ k, c }: { k: string; c: PetDef }): ReactNode {
  switch (k) {
    case 'chick':
      return <path d="M50 22 q-4 -10 -9 -8 q4 3 3 9 M50 22 q2 -11 9 -10 q-5 3 -4 10" fill={c.body} stroke="#E0B21F" strokeWidth="1.5" strokeLinejoin="round" />;
    case 'cat':
      return (
        <g>
          <path d="M25 40 L24 16 L42 30 Z" fill={c.body} />
          <path d="M75 40 L76 16 L58 30 Z" fill={c.body} />
          <path d="M28 34 L28 23 L37 30 Z" fill="#FFB6C1" />
          <path d="M72 34 L72 23 L63 30 Z" fill="#FFB6C1" />
          <path d="M78 82 q18 -2 14 -22" fill="none" stroke={c.body} strokeWidth="8" strokeLinecap="round" />
        </g>
      );
    case 'dog':
      return (
        <g>
          <ellipse cx="22" cy="48" rx="9" ry="17" fill="#8B5A2B" transform="rotate(12 22 48)" />
          <ellipse cx="78" cy="48" rx="9" ry="17" fill="#8B5A2B" transform="rotate(-12 78 48)" />
          <path d="M80 80 q14 -6 10 -18" fill="none" stroke={c.body} strokeWidth="7" strokeLinecap="round" />
        </g>
      );
    case 'rabbit':
      return (
        <g>
          <ellipse cx="37" cy="20" rx="8" ry="20" fill={c.body} stroke="#E4D9D3" strokeWidth="1.4" transform="rotate(-8 37 20)" />
          <ellipse cx="63" cy="20" rx="8" ry="20" fill={c.body} stroke="#E4D9D3" strokeWidth="1.4" transform="rotate(8 63 20)" />
          <ellipse cx="37" cy="21" rx="3.6" ry="13" fill="#FFC0CB" transform="rotate(-8 37 21)" />
          <ellipse cx="63" cy="21" rx="3.6" ry="13" fill="#FFC0CB" transform="rotate(8 63 21)" />
        </g>
      );
    case 'fox':
      return (
        <g>
          <path d="M24 40 L24 14 L43 30 Z" fill={c.body} />
          <path d="M76 40 L76 14 L57 30 Z" fill={c.body} />
          <path d="M24 22 L24 14 L31 19 Z" fill={INK} />
          <path d="M76 22 L76 14 L69 19 Z" fill={INK} />
          <path d="M78 84 q22 -4 14 -26 q-6 14 -20 16 Z" fill={c.body} />
          <path d="M92 58 q-3 8 -9 12 q8 0 11 -6 Z" fill="#fff" />
        </g>
      );
    case 'panda':
      return (
        <g>
          <circle cx="27" cy="30" r="10" fill={INK} />
          <circle cx="73" cy="30" r="10" fill={INK} />
        </g>
      );
    case 'unicorn':
      return (
        <g>
          <path d="M26 42 L26 16 L44 30 Z" fill={c.body} stroke="#E9DDF5" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M74 42 L74 16 L56 30 Z" fill={c.body} stroke="#E9DDF5" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M20 44 q-8 14 2 30 q2 -12 6 -18 Z" fill="#C9A7FF" />
          <path d="M80 44 q8 14 -2 30 q-2 -12 -6 -18 Z" fill="#FF9FD2" />
        </g>
      );
  }
  return null;
}

function PetFront({ k, c }: { k: string; c: PetDef }): ReactNode {
  const cheeks = (
    <>
      <ellipse cx="31" cy="64" rx="5" ry="3.2" fill={BLUSH} opacity="0.75" />
      <ellipse cx="69" cy="64" rx="5" ry="3.2" fill={BLUSH} opacity="0.75" />
    </>
  );
  const mouth = <path d="M45 65 q5 5 10 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />;
  switch (k) {
    case 'chick':
      return (
        <g>
          <ellipse cx="50" cy="72" rx="16" ry="11" fill={c.belly} />
          {cheeks}
          <path d="M44 62 L56 62 L50 70 Z" fill="#FF9A2E" stroke="#E27B0F" strokeWidth="1.2" strokeLinejoin="round" />
        </g>
      );
    case 'cat':
      return (
        <g>
          <ellipse cx="50" cy="74" rx="15" ry="10" fill={c.belly} />
          <path d="M44 38 l2 7 M50 36 v8 M56 38 l-2 7" stroke="#D67F2E" strokeWidth="2.2" strokeLinecap="round" />
          {cheeks}
          <path d="M48 62 h4 l-2 3 Z" fill="#FF8FA3" />
          {mouth}
          <path d="M26 60 h-9 M26 65 l-8 3 M74 60 h9 M74 65 l8 3" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
        </g>
      );
    case 'dog':
      return (
        <g>
          <ellipse cx="50" cy="66" rx="14" ry="11" fill={c.belly} />
          <ellipse cx="50" cy="61" rx="5" ry="3.6" fill={INK} />
          <path d="M45 67 q5 6 10 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <path d="M48 69 q2 6 4 0 Z" fill="#FF7F9A" />
          {cheeks}
        </g>
      );
    case 'rabbit':
      return (
        <g>
          {cheeks}
          <path d="M47 62 h6 l-3 3.4 Z" fill="#FF8FA3" />
          <path d="M50 65.4 v2 M50 67.4 q-4 3 -7 0 M50 67.4 q4 3 7 0" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
          <rect x="47" y="68" width="3" height="5" rx="1" fill="#fff" stroke="#E4D9D3" strokeWidth="1" />
          <rect x="50" y="68" width="3" height="5" rx="1" fill="#fff" stroke="#E4D9D3" strokeWidth="1" />
        </g>
      );
    case 'fox':
      return (
        <g>
          <path d="M22 60 q14 4 28 14 q14 -10 28 -14 q-4 22 -28 24 q-24 -2 -28 -24 Z" fill={c.belly} />
          <ellipse cx="50" cy="63" rx="3.6" ry="2.8" fill={INK} />
          <path d="M45 67 q5 5 10 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case 'panda':
      return (
        <g>
          <ellipse cx="50" cy="63" rx="4" ry="3" fill={INK} />
          <path d="M45 68 q5 5 10 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <circle cx="31" cy="66" r="4" fill={BLUSH} opacity="0.6" />
          <circle cx="69" cy="66" r="4" fill={BLUSH} opacity="0.6" />
        </g>
      );
    case 'unicorn':
      return (
        <g>
          <path d="M50 8 L44 32 L56 32 Z" fill="#FFC928" stroke="#D99A00" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M46 24 l8 -3 M47 18 l6 -2" stroke="#D99A00" strokeWidth="1.2" />
          <path d="M30 36 q20 -8 40 0 q-4 -8 -20 -9 q-16 1 -20 9 Z" fill="#FF9FD2" />
          {cheeks}
          {mouth}
        </g>
      );
  }
  return null;
}

function PetSvg({ species, stage, sleepy = false, size = 64 }: { species: string; stage: number; sleepy?: boolean; size?: number }) {
  const c = PET[species] ?? PET.chick;
  // 蛋：用物種主色畫幾塊斑點，孵化前就能看出是哪一隻
  if (stage <= 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="蛋">
        <ellipse cx="50" cy="92" rx="22" ry="4" fill="#000" opacity="0.08" />
        <path d="M50 14 C74 14 82 52 82 66 C82 82 68 92 50 92 C32 92 18 82 18 66 C18 52 26 14 50 14 Z" fill="#FFF6E5" stroke="#E5D3B3" strokeWidth="2" />
        <circle cx="38" cy="52" r="7" fill={species === 'panda' || species === 'rabbit' || species === 'unicorn' ? '#CFC4E8' : c.body} opacity="0.85" />
        <circle cx="62" cy="68" r="8" fill={species === 'panda' || species === 'rabbit' || species === 'unicorn' ? '#CFC4E8' : c.body} opacity="0.85" />
        <circle cx="52" cy="34" r="4.5" fill={species === 'panda' || species === 'rabbit' || species === 'unicorn' ? '#CFC4E8' : c.body} opacity="0.85" />
        <path d="M34 28 q4 -8 12 -10" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.9" />
      </svg>
    );
  }
  const scale = [0, 0.66, 0.84, 1][Math.min(3, stage)];
  const outline = species === 'panda' || species === 'rabbit' || species === 'unicorn' ? '#E4DCE0' : 'rgba(0,0,0,0.12)';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="寵物">
      <ellipse cx="50" cy="93" rx={26 * scale} ry="4" fill="#000" opacity="0.08" />
      <g transform={`translate(50 92) scale(${scale}) translate(-50 -92)`}>
        <PetBack k={species} c={c} />
        <circle cx="50" cy="58" r="31" fill={c.body} stroke={outline} strokeWidth="2" />
        <PetFront k={species} c={c} />
        <Eyes sleepy={sleepy} panda={species === 'panda'} />
        {stage >= 3 && <Crown />}
        {stage >= 2 && <Sparkle x={86} y={30} s={0.9} />}
        {stage >= 3 && <Sparkle x={14} y={22} s={0.7} />}
      </g>
    </svg>
  );
}

// ---------------- 植物 ----------------
function Petals({ cx, cy, n, rx, ry, dist, fill, stroke }: { cx: number; cy: number; n: number; rx: number; ry: number; dist: number; fill: string; stroke?: string }) {
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <ellipse key={i} cx={cx} cy={cy - dist} rx={rx} ry={ry} fill={fill} stroke={stroke} strokeWidth="0.8" transform={`rotate(${(360 / n) * i} ${cx} ${cy})`} />
      ))}
    </g>
  );
}

function Leaf({ x, y, dir, s = 1 }: { x: number; y: number; dir: 1 | -1; s?: number }) {
  return <path transform={`translate(${x} ${y}) scale(${dir * s} ${s})`} d="M0 0 C6 -10 16 -10 20 -4 C14 4 6 6 0 0 Z" fill="#5BBF72" stroke="#3E9A56" strokeWidth="1" strokeLinejoin="round" />;
}

function PlantSvg({ plant, progress, size = 64 }: { plant: string; progress: number; size?: number }) {
  const st = progress >= 1 ? 4 : progress >= 0.75 ? 3 : progress >= 0.5 ? 2 : progress >= 0.25 ? 1 : 0;
  const topY = 74 - [6, 18, 30, 40, 42][st];
  const cx = 50;
  const tree = plant === 'apple';

  const pot = (
    <g>
      <path d="M30 74 L70 74 L65 94 Q50 98 35 94 Z" fill="#D98B57" stroke="#B66A38" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="27" y="68" width="46" height="9" rx="4" fill="#E69E6A" stroke="#B66A38" strokeWidth="1.6" />
      <ellipse cx="50" cy="69" rx="21" ry="3.2" fill="#7A4B2A" />
    </g>
  );

  let body: ReactNode = null;
  if (tree) {
    body = (
      <g>
        <path d={`M50 70 L50 ${topY + 6}`} stroke="#8A5A33" strokeWidth={st >= 2 ? 6 : 3.4} strokeLinecap="round" />
        {st <= 1 && (
          <>
            <Leaf x={50} y={topY + 8} dir={1} s={0.9} />
            <Leaf x={50} y={topY + 14} dir={-1} s={0.9} />
          </>
        )}
        {st >= 2 && (
          <g>
            <circle cx="50" cy={topY - 2} r={st === 2 ? 17 : 22} fill="#5BBF72" stroke="#3E9A56" strokeWidth="1.6" />
            <circle cx="38" cy={topY + 4} r="12" fill="#6CCB82" />
            <circle cx="62" cy={topY + 4} r="12" fill="#6CCB82" />
            {st === 2 && <circle cx="50" cy={topY - 4} r="3.4" fill="#FFB6C9" />}
            {st === 3 && [[40, -6], [58, -8], [50, 6], [64, 4], [36, 6]].map(([dx, dy], i) => <circle key={i} cx={dx} cy={topY + dy} r="4" fill="#FFC9D6" stroke="#F58AA8" strokeWidth="0.8" />)}
            {st === 4 && [[40, -6], [58, -8], [50, 6], [63, 6]].map(([dx, dy], i) => (
              <g key={i}>
                <circle cx={dx} cy={topY + dy} r="5.6" fill="#E8453C" stroke="#B8281F" strokeWidth="1" />
                <path d={`M${dx} ${topY + dy - 5} q2 -4 4 -4`} stroke="#3E9A56" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              </g>
            ))}
          </g>
        )}
      </g>
    );
  } else {
    const stem = <path d={`M${cx} 70 L${cx} ${topY}`} stroke="#4FAE66" strokeWidth="3.6" strokeLinecap="round" />;
    const leaves = (
      <g>
        {st >= 0 && st < 1 && (
          <>
            <Leaf x={cx} y={topY + 2} dir={1} s={0.8} />
            <Leaf x={cx} y={topY + 2} dir={-1} s={0.8} />
          </>
        )}
        {st >= 1 && (
          <>
            <Leaf x={cx} y={66} dir={1} />
            <Leaf x={cx} y={58} dir={-1} />
            {st >= 2 && <Leaf x={cx} y={48} dir={1} s={0.9} />}
            {st >= 3 && <Leaf x={cx} y={42} dir={-1} s={0.8} />}
          </>
        )}
      </g>
    );
    let top: ReactNode = null;
    if (st === 2) {
      const bud: Record<string, string> = { sunflower: '#9BC53D', strawberry: '#BFE3A0', tomato: '#B6D96A', lavender: '#B79CF2' };
      top = <ellipse cx={cx} cy={topY - 4} rx="5" ry="7" fill={bud[plant] ?? '#9BC53D'} stroke="#3E9A56" strokeWidth="1" />;
    } else if (st >= 3) {
      const big = st === 4;
      switch (plant) {
        case 'sunflower':
          top = (
            <g>
              <Petals cx={cx} cy={topY - 6} n={10} rx={big ? 5 : 4} ry={big ? 11 : 9} dist={big ? 12 : 10} fill="#FFC928" stroke="#E09D00" />
              <circle cx={cx} cy={topY - 6} r={big ? 9 : 7} fill="#7A4B2A" />
              <circle cx={cx - 2} cy={topY - 8} r="1.4" fill="#A9703F" />
              <circle cx={cx + 3} cy={topY - 5} r="1.4" fill="#A9703F" />
            </g>
          );
          break;
        case 'strawberry':
          top = big ? (
            <g>
              {[[-14, 8], [12, 4], [0, -6]].map(([dx, dy], i) => (
                <g key={i} transform={`translate(${cx + dx} ${topY + dy})`}>
                  <path d="M0 -8 C10 -8 11 4 0 13 C-11 4 -10 -8 0 -8 Z" fill="#EF4057" stroke="#B91F36" strokeWidth="1.2" />
                  <path d="M-5 -8 l5 -4 l5 4 l-5 1.5 Z" fill="#3E9A56" />
                  <circle cx="-3" cy="-1" r="0.9" fill="#FFE9A8" />
                  <circle cx="3" cy="1" r="0.9" fill="#FFE9A8" />
                  <circle cx="0" cy="6" r="0.9" fill="#FFE9A8" />
                </g>
              ))}
            </g>
          ) : (
            <g>
              <Petals cx={cx} cy={topY - 4} n={5} rx={5} ry={6.4} dist={6.5} fill="#FFFFFF" stroke="#E7D5DD" />
              <circle cx={cx} cy={topY - 4} r="3.4" fill="#FFC928" />
            </g>
          );
          break;
        case 'tomato':
          top = big ? (
            <g>
              {[[-12, 8], [12, 2]].map(([dx, dy], i) => (
                <g key={i} transform={`translate(${cx + dx} ${topY + dy})`}>
                  <circle r="9.5" fill="#EA4335" stroke="#B3261E" strokeWidth="1.2" />
                  <path d="M-5 -8 l5 2 l5 -2 l-3 4 l-2 -1 l-2 1 Z" fill="#3E9A56" />
                  <circle cx="-3.4" cy="-3" r="1.8" fill="#fff" opacity="0.5" />
                </g>
              ))}
            </g>
          ) : (
            <g>
              <Petals cx={cx} cy={topY - 4} n={6} rx={2.8} ry={6.4} dist={6} fill="#FFD84D" stroke="#E0A100" />
              <circle cx={cx} cy={topY - 4} r="2.6" fill="#E0A100" />
            </g>
          );
          break;
        case 'lavender':
          top = (
            <g>
              {[-9, 0, 9].map((dx, i) => (
                <g key={i}>
                  <path d={`M${cx + dx * 0.4} ${topY + 6} L${cx + dx} ${topY - 4}`} stroke="#4FAE66" strokeWidth="2.2" strokeLinecap="round" />
                  {Array.from({ length: big ? 6 : 4 }, (_, j) => (
                    <ellipse key={j} cx={cx + dx + (j % 2 ? 1.6 : -1.6)} cy={topY - 6 - j * 4.4 + (i === 1 ? 0 : 4)} rx="3.2" ry="2.6" fill={j % 2 ? '#9B7BEA' : '#B79CF2'} stroke="#7B5CCB" strokeWidth="0.6" />
                  ))}
                </g>
              ))}
            </g>
          );
          break;
      }
    }
    body = (
      <g>
        {stem}
        {leaves}
        {top}
      </g>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="植物">
      {pot}
      {body}
      {st === 4 && (
        <g>
          <Sparkle x={18} y={34} s={0.9} />
          <Sparkle x={84} y={26} s={0.7} />
          <Sparkle x={80} y={56} s={0.6} />
        </g>
      )}
    </svg>
  );
}

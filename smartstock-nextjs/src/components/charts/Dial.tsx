'use client';

import { memo, type ReactNode } from 'react';
import ProduceIcon from '../produce/ProduceIcon';

export interface DialItem {
  commodity: string;
  days: number;
}

interface DialProps {
  items: DialItem[];
  /** Days shown around the full circle */
  maxDays?: number;
  size?: number;
  /** Content in the middle of the dial (big number and caption) */
  center: ReactNode;
  /** Below this many days an item is critical; below `warnDays` it needs ordering */
  criticalDays?: number;
  warnDays?: number;
  onSelect?: (commodity: string) => void;
}

const TICKS_PER_DAY = 4;

// Pelago-style radial dial, read like a clock face: days of cover run clockwise from the top,
// and each item in the walk-in sits on the ring at the day it runs out.
function DialBase({ items, maxDays = 14, size = 240, center, criticalDays = 3, warnDays = 6, onSelect }: DialProps) {
  const c = size / 2;
  const rTick = c - 34;
  const rIcon = c - 14;
  const total = maxDays * TICKS_PER_DAY;
  const angle = (days: number) => (Math.min(days, maxDays) / maxDays) * 2 * Math.PI - Math.PI / 2;
  const soonest = items.length ? Math.min(...items.map((i) => i.days)) : undefined;

  // Items that run out on the same day would overlap; nudge the later ones inward
  const placed = [...items]
    .sort((a, b) => a.days - b.days)
    .map((item, i, arr) => {
      const crowded = arr.slice(0, i).filter((p) => Math.abs(Math.min(p.days, maxDays) - Math.min(item.days, maxDays)) < maxDays / 22).length;
      const r = rIcon - crowded * 22;
      const a = angle(item.days);
      return { ...item, x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
    });

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true" className="block">
        {Array.from({ length: total }, (_, i) => {
          const day = i / TICKS_PER_DAY;
          const a = (i / total) * 2 * Math.PI - Math.PI / 2;
          const major = i % (TICKS_PER_DAY * 7) === 0;
          const len = major ? 12 : i % TICKS_PER_DAY === 0 ? 8 : 5;
          // Ticks up to the soonest run-out are lit, colored by how urgent that window is
          const lit = soonest !== undefined && day <= soonest;
          const color = day < criticalDays ? '#b3361f' : day < warnDays ? '#d99a1e' : '#2e6a4e';
          return (
            <line
              key={i}
              x1={c + (rTick - len) * Math.cos(a)}
              y1={c + (rTick - len) * Math.sin(a)}
              x2={c + rTick * Math.cos(a)}
              y2={c + rTick * Math.sin(a)}
              stroke={lit ? color : 'rgba(28,33,30,0.16)'}
              strokeWidth={major ? 2 : 1.4}
              strokeLinecap="round"
              opacity={lit ? 0.9 : 1}
            />
          );
        })}
        {[0, 7].map((d) => {
          const a = angle(d);
          const r = rTick - 24;
          return (
            <text key={d} x={c + r * Math.cos(a)} y={c + r * Math.sin(a)} textAnchor="middle" dy="0.35em" fontSize="10" className="font-mono" fill="#6b716d">
              {d === 0 ? 'today' : `${d}d`}
            </text>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-14 text-center">{center}</div>
      {placed.map((p) => (
        <button
          key={p.commodity}
          type="button"
          onClick={() => onSelect?.(p.commodity)}
          aria-label={`${p.commodity}: ${p.days.toFixed(1)} days of cover`}
          title={`${p.commodity}: ${p.days.toFixed(1)} days`}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface shadow-[0_2px_8px_rgb(28_33_30/0.12)] ring-1 ring-line"
          style={{ left: p.x, top: p.y }}
        >
          <ProduceIcon commodity={p.commodity} size={30} bubble decorative />
        </button>
      ))}
    </div>
  );
}

export const Dial = memo(DialBase);
export default Dial;

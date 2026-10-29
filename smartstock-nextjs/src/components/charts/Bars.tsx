'use client';

import { memo, useId, useMemo, useState } from 'react';
import { useWidth } from './hooks';
import { clamp, linear, padDomain } from './scale';

export interface BarDatum {
  key: string;
  /** Short label under the bar ("Mon", "Wk 2") */
  label: string;
  value: number;
  /** Draws the bar in the highlight color (e.g. the cheapest day) */
  highlight?: boolean;
  /** Tooltip text; defaults to "label: value" */
  note?: string;
}

interface BarsProps {
  data: BarDatum[];
  height?: number;
  format?: (n: number) => string;
  color?: string;
  highlightColor?: string;
  /** "zero" starts bars at 0 (spend); "auto" zooms to the data (prices that move by cents) */
  baseline?: 'zero' | 'auto';
  label: string;
  /** Value printed above each bar */
  showValues?: boolean;
  animKey?: string;
}

function BarsBase({
  data,
  height = 200,
  format = (n) => `$${n.toFixed(2)}`,
  color = '#2e6a4e',
  highlightColor = '#5b5bd6',
  baseline = 'zero',
  label,
  showValues = false,
  animKey,
}: BarsProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');

  const geo = useMemo(() => {
    if (!width || !data.length) return null;
    const padT = showValues ? 22 : 10;
    const padB = 24;
    const plotH = height - padT - padB;
    const slot = width / data.length;
    const barW = clamp(slot * 0.58, 6, 44);
    const values = data.map((d) => d.value);
    const [lo, hi] = baseline === 'zero' ? [0, Math.max(...values) * 1.08 || 1] : padDomain(values, 0.35);
    const y = linear(lo, hi, padT + plotH, padT);
    return { padT, plotH, slot, barW, y, baseY: padT + plotH };
  }, [width, height, data, baseline, showValues]);

  return (
    <div ref={ref} className="relative w-full" style={{ height }} role="img" aria-label={label}>
      {geo && (
        <svg width={width} height={height} className="block" aria-hidden="true">
          <defs>
            <linearGradient id={`b-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.95" />
              <stop offset="100%" stopColor={color} stopOpacity="0.55" />
            </linearGradient>
            <linearGradient id={`h-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={highlightColor} stopOpacity="1" />
              <stop offset="100%" stopColor={highlightColor} stopOpacity="0.6" />
            </linearGradient>
            <clipPath id={`c-${uid}`}>
              <rect x={0} y={0} width={width} height={geo.baseY} />
            </clipPath>
          </defs>
          <line x1={0} x2={width} y1={geo.baseY + 0.5} y2={geo.baseY + 0.5} stroke="rgba(28,33,30,0.1)" />
          <g key={animKey} clipPath={`url(#c-${uid})`}>
            {data.map((d, i) => {
              const cx = geo.slot * i + geo.slot / 2;
              const top = geo.y(d.value);
              return (
                <rect
                  key={d.key}
                  className="grow-bar"
                  style={{ animationDelay: `${i * 45}ms` }}
                  x={cx - geo.barW / 2}
                  y={top}
                  width={geo.barW}
                  height={Math.max(3, geo.baseY - top) + 10}
                  rx={Math.min(10, geo.barW / 2)}
                  fill={d.highlight ? `url(#h-${uid})` : `url(#b-${uid})`}
                  opacity={hover !== null && hover !== i ? 0.45 : 1}
                />
              );
            })}
          </g>
          {data.map((d, i) => {
            const cx = geo.slot * i + geo.slot / 2;
            return (
              <g key={d.key}>
                {showValues && (
                  <text x={cx} y={geo.y(d.value) - 7} textAnchor="middle" fontSize="10.5" className="tabular font-mono" fill={d.highlight ? highlightColor : '#5a605c'}>
                    {format(d.value)}
                  </text>
                )}
                <text x={cx} y={height - 6} textAnchor="middle" fontSize="11" className="font-mono" fill={d.highlight ? highlightColor : '#6b716d'} fontWeight={d.highlight ? 600 : 400}>
                  {d.label}
                </text>
                <rect
                  x={geo.slot * i}
                  y={0}
                  width={geo.slot}
                  height={height}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {geo && hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[10px] border border-line bg-surface px-2.5 py-1.5 text-[12px] font-semibold shadow-pop"
          style={{ left: clamp(geo.slot * hover + geo.slot / 2, 60, width - 60), top: Math.max(0, geo.y(data[hover].value) - 8) }}
        >
          {data[hover].note ?? `${data[hover].label}: ${format(data[hover].value)}`}
        </div>
      )}
    </div>
  );
}

export const Bars = memo(BarsBase);
export default Bars;

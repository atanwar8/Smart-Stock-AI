'use client';

import { memo, useId } from 'react';
import { linear, padDomain, smoothPath, type Pt } from './scale';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Soft area under the line */
  area?: boolean;
  label?: string;
}

// Fixed-size inline trend line for lists and table rows
function SparklineBase({ values, width = 72, height = 24, color = '#2e6a4e', area = true, label }: SparklineProps) {
  const uid = useId().replace(/:/g, '');
  if (values.length < 2) return <span style={{ display: 'inline-block', width, height }} aria-hidden="true" />;
  const [lo, hi] = padDomain(values, 0.15);
  const x = linear(0, values.length - 1, 2, width - 3);
  const y = linear(lo, hi, height - 2, 2);
  const pts: Pt[] = values.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="block overflow-visible">
      <defs>
        <linearGradient id={`s-${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={`${line}L${last[0]},${height}L${pts[0][0]},${height}Z`} fill={`url(#s-${uid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.4} fill={color} />
    </svg>
  );
}

export const Sparkline = memo(SparklineBase);
export default Sparkline;

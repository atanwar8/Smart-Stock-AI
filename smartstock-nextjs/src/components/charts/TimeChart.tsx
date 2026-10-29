'use client';

import { memo, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useWidth } from './hooks';
import { bandPath, clamp, linear, niceTicks, padDomain, shortDay, smoothPath, toTime, type Pt } from './scale';

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface RangePoint {
  date: string;
  value: number;
  lo?: number;
  hi?: number;
}

export interface TimeChartProps {
  /** Real prices, oldest first */
  actual: SeriesPoint[];
  /** Predicted prices (iris, dashed); points with lo/hi draw the cone of uncertainty */
  forecast?: RangePoint[];
  /** "Usual" band drawn behind the actual line, for anomaly views */
  expected?: { date: string; lo: number; hi: number }[];
  height?: number;
  /** Draw on the dark night card */
  night?: boolean;
  /** "bars" draws the history as luminous bars (hero card); "line" as a line with a soft area */
  actualStyle?: 'line' | 'bars';
  actualColor?: string;
  format?: (n: number) => string;
  /** Accessible summary of what the chart shows */
  label: string;
  showYAxis?: boolean;
  showXAxis?: boolean;
  /** Pill above the last real point, e.g. "Latest report" */
  marker?: string;
  /** Changing this replays the entrance animation (e.g. pass the commodity) */
  animKey?: string;
  className?: string;
}

const ACCENT = '#2e6a4e';
const IRIS = '#5b5bd6';
const IRIS_NIGHT = '#a5a6ff';

function TimeChartBase({
  actual,
  forecast = [],
  expected = [],
  height = 240,
  night = false,
  actualStyle = 'line',
  actualColor,
  format = (n) => `$${n.toFixed(2)}`,
  label,
  showYAxis = true,
  showXAxis = true,
  marker,
  animKey,
  className,
}: TimeChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');

  const colors = {
    actual: actualColor ?? (night ? '#7ee2b8' : ACCENT),
    forecast: night ? IRIS_NIGHT : IRIS,
    grid: night ? 'rgba(232,238,244,0.08)' : 'rgba(28,33,30,0.07)',
    tick: night ? 'rgba(232,238,244,0.55)' : '#6b716d',
    guide: night ? 'rgba(232,238,244,0.35)' : 'rgba(28,33,30,0.25)',
    band: night ? 'rgba(232,238,244,0.07)' : 'rgba(28,33,30,0.055)',
    surface: night ? '#0f1823' : '#ffffff',
  };

  const geo = useMemo(() => {
    if (!width || !actual.length) return null;
    const padL = showYAxis ? 44 : 6;
    const padR = 14;
    const padT = marker ? 30 : 14;
    const padB = showXAxis ? 26 : 6;
    const plotW = Math.max(10, width - padL - padR);
    const plotH = Math.max(10, height - padT - padB);

    // Forecasts start from the last real price so the two read as one continuous story
    const last = actual[actual.length - 1];
    const fc: RangePoint[] = forecast.length ? [{ date: last.date, value: last.value, lo: last.value, hi: last.value }, ...forecast.filter((f) => f.date > last.date)] : [];

    const dates = Array.from(new Set([...actual.map((p) => p.date), ...fc.map((p) => p.date), ...expected.map((p) => p.date)])).sort();
    const t0 = toTime(dates[0]);
    const t1 = toTime(dates[dates.length - 1]);
    // Bars need half a slot of room at both ends
    const slot = actualStyle === 'bars' ? plotW / Math.max(1, dates.length) : 0;
    const x = t0 === t1 ? () => padL + plotW / 2 : linear(t0, t1, padL + slot / 2, padL + plotW - slot / 2);

    const values = [
      ...actual.map((p) => p.value),
      ...fc.flatMap((p) => [p.value, p.lo ?? p.value, p.hi ?? p.value]),
      ...expected.flatMap((p) => [p.lo, p.hi]),
    ];
    const [lo, hi] = padDomain(values, actualStyle === 'bars' ? 0.25 : 0.1);
    const y = linear(lo, hi, padT + plotH, padT);

    const actualPts: Pt[] = actual.map((p) => [x(toTime(p.date)), y(p.value)]);
    const fcPts: Pt[] = fc.map((p) => [x(toTime(p.date)), y(p.value)]);
    const hasCone = fc.some((p, i) => i > 0 && p.lo !== undefined && p.hi !== undefined);
    const cone = hasCone ? bandPath(fc.map((p) => [x(toTime(p.date)), y(p.hi ?? p.value)]), fc.map((p) => [x(toTime(p.date)), y(p.lo ?? p.value)])) : '';
    const expectedBand = expected.length > 1 ? bandPath(expected.map((p) => [x(toTime(p.date)), y(p.hi)]), expected.map((p) => [x(toTime(p.date)), y(p.lo)])) : '';
    const baseY = padT + plotH;
    const area = actualPts.length > 1 ? `${smoothPath(actualPts)}L${actualPts[actualPts.length - 1][0]},${baseY}L${actualPts[0][0]},${baseY}Z` : '';
    const barW = clamp(slot * 0.56, 3, 22);

    // Thin out x labels so they never collide
    const maxLabels = Math.max(2, Math.floor(plotW / 64));
    const every = Math.ceil(dates.length / maxLabels);
    const xLabels = dates.filter((_, i) => i % every === 0 || i === dates.length - 1).filter((d, i, arr) => i === arr.length - 1 || x(toTime(arr[arr.length - 1])) - x(toTime(d)) > 48);

    return {
      padL, padT, plotW, plotH, baseY, x, y, dates, fc, actualPts, fcPts, cone, expectedBand, area, barW,
      yTicks: niceTicks(lo, hi, height < 160 ? 2 : 4).filter((t) => y(t) >= padT - 1 && y(t) <= baseY + 1),
      xLabels,
      lastX: actualPts[actualPts.length - 1][0],
      lastY: actualPts[actualPts.length - 1][1],
    };
  }, [width, height, actual, forecast, expected, showYAxis, showXAxis, marker, actualStyle]);

  const hoverInfo = useMemo(() => {
    if (!geo || hover === null) return null;
    const date = geo.dates[hover];
    if (!date) return null;
    const a = actual.find((p) => p.date === date);
    const f = geo.fc.find((p, i) => i > 0 && p.date === date);
    const e = expected.find((p) => p.date === date);
    return { date, a, f, e, x: geo.x(toTime(date)) };
  }, [geo, hover, actual, expected]);

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    if (!geo) return;
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    geo.dates.forEach((d, i) => {
      const dist = Math.abs(geo.x(toTime(d)) - px);
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    });
    setHover(best);
  };

  // Arrow keys walk through the points for keyboard users
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!geo) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setHover((h) => {
        const cur = h ?? (e.key === 'ArrowRight' ? -1 : geo.dates.length);
        return clamp(cur + (e.key === 'ArrowRight' ? 1 : -1), 0, geo.dates.length - 1);
      });
    }
    if (e.key === 'Escape') setHover(null);
  };

  return (
    <div
      ref={ref}
      className={['relative w-full rounded-tile outline-offset-4', className].filter(Boolean).join(' ')}
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={label}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
    >
      {geo && (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={`area-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={colors.actual} stopOpacity={night ? 0.32 : 0.16} />
              <stop offset="100%" stopColor={colors.actual} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`bar-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={colors.actual} stopOpacity="1" />
              <stop offset="100%" stopColor={colors.actual} stopOpacity={night ? 0.12 : 0.25} />
            </linearGradient>
            <linearGradient id={`cone-${uid}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={colors.forecast} stopOpacity={night ? 0.34 : 0.22} />
              <stop offset="100%" stopColor={colors.forecast} stopOpacity={night ? 0.14 : 0.08} />
            </linearGradient>
            <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
            <clipPath id={`clip-${uid}`}>
              <rect x={0} y={geo.padT - 6} width={width} height={geo.plotH + 6} />
            </clipPath>
          </defs>

          {/* Grid and y labels */}
          {geo.yTicks.map((t) => (
            <g key={t}>
              <line x1={geo.padL} x2={geo.padL + geo.plotW} y1={geo.y(t)} y2={geo.y(t)} stroke={colors.grid} strokeDasharray="2 4" />
              {showYAxis && (
                <text x={geo.padL - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" fontSize="10.5" fill={colors.tick} className="tabular font-mono">
                  {format(t)}
                </text>
              )}
            </g>
          ))}

          <g key={animKey} clipPath={`url(#clip-${uid})`}>
            {geo.expectedBand && <path d={geo.expectedBand} fill={colors.band} className="fade-in" />}

            {actualStyle === 'bars' ? (
              <>
                {/* A blurred copy under the bars gives the luminous glow */}
                <g filter={`url(#glow-${uid})`} opacity={night ? 0.55 : 0.25}>
                  {geo.actualPts.map(([px, py], i) => (
                    <rect key={i} x={px - geo.barW / 2} y={py} width={geo.barW} height={Math.max(2, geo.baseY - py)} rx={geo.barW / 2} fill={colors.actual} />
                  ))}
                </g>
                {geo.actualPts.map(([px, py], i) => (
                  <rect
                    key={i}
                    className="grow-bar"
                    style={{ animationDelay: `${i * 35}ms` }}
                    x={px - geo.barW / 2}
                    y={py}
                    width={geo.barW}
                    height={Math.max(2, geo.baseY - py + geo.barW)}
                    rx={geo.barW / 2}
                    fill={`url(#bar-${uid})`}
                    opacity={hoverInfo && hoverInfo.a && hoverInfo.x !== px ? 0.55 : 1}
                  />
                ))}
              </>
            ) : (
              <>
                {geo.area && <path d={geo.area} fill={`url(#area-${uid})`} className="fade-in" />}
                <path d={smoothPath(geo.actualPts)} fill="none" stroke={colors.actual} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="draw-line" />
              </>
            )}

            {geo.cone && <path d={geo.cone} fill={`url(#cone-${uid})`} className="fade-in" style={{ animationDelay: '250ms' }} />}
            {geo.fcPts.length > 1 && (
              <path d={smoothPath(geo.fcPts)} fill="none" stroke={colors.forecast} strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" className="fade-in" style={{ animationDelay: '300ms' }} />
            )}
            {geo.fcPts.slice(1).map(([px, py], i) => (
              <circle key={i} cx={px} cy={py} r={3} fill={colors.surface} stroke={colors.forecast} strokeWidth={1.75} className="fade-in" style={{ animationDelay: `${350 + i * 40}ms` }} />
            ))}
          </g>

          {/* Latest real price */}
          {marker && (
            <g>
              <line x1={geo.lastX} x2={geo.lastX} y1={geo.padT - 6} y2={geo.baseY} stroke={colors.guide} strokeDasharray="2 3" />
              <g transform={`translate(${clamp(geo.lastX, geo.padL + 40, geo.padL + geo.plotW - 40)}, ${geo.padT - 18})`}>
                <rect x={-40} y={-9} width={80} height={18} rx={9} fill={night ? 'rgba(232,238,244,0.12)' : '#1c1f1d'} />
                <text textAnchor="middle" dy="0.34em" fontSize="10" fill={night ? '#e8eef4' : '#fff'} className="font-mono" letterSpacing="0.06em">
                  {marker.toUpperCase()}
                </text>
              </g>
            </g>
          )}
          {actualStyle === 'line' && <circle cx={geo.lastX} cy={geo.lastY} r={4} fill={colors.actual} stroke={colors.surface} strokeWidth={2} />}

          {/* X labels */}
          {showXAxis &&
            geo.xLabels.map((d) => (
              <text key={d} x={geo.x(toTime(d))} y={height - 6} textAnchor="middle" fontSize="10.5" fill={colors.tick} className="font-mono">
                {shortDay(d)}
              </text>
            ))}

          {/* Hover guide */}
          {hoverInfo && (
            <g pointerEvents="none">
              <line x1={hoverInfo.x} x2={hoverInfo.x} y1={geo.padT} y2={geo.baseY} stroke={colors.guide} />
              {hoverInfo.a && <circle cx={hoverInfo.x} cy={geo.y(hoverInfo.a.value)} r={4.5} fill={colors.actual} stroke={colors.surface} strokeWidth={2} />}
              {hoverInfo.f && <circle cx={hoverInfo.x} cy={geo.y(hoverInfo.f.value)} r={4.5} fill={colors.forecast} stroke={colors.surface} strokeWidth={2} />}
            </g>
          )}

          <rect
            x={geo.padL}
            y={0}
            width={geo.plotW}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}

      {hoverInfo && geo && (
        <div
          className={[
            'pointer-events-none absolute top-0 z-10 min-w-[132px] -translate-x-1/2 rounded-[12px] px-3 py-2 text-[12px] shadow-pop',
            night ? 'bg-[#1d2a3a] text-night-ink ring-1 ring-white/10' : 'border border-line bg-surface text-ink',
          ].join(' ')}
          style={{ left: clamp(hoverInfo.x, 72, width - 72) }}
        >
          <div className={['micro mb-1', night ? 'text-night-ink/60' : 'text-faint'].join(' ')}>{shortDay(hoverInfo.date)}</div>
          {hoverInfo.a && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: colors.actual }} />
                Actual
              </span>
              <b className="tabular font-semibold">{format(hoverInfo.a.value)}</b>
            </div>
          )}
          {hoverInfo.e && !hoverInfo.f && (
            <div className={['tabular mt-0.5', night ? 'text-night-ink/60' : 'text-faint'].join(' ')}>
              Usual {format(hoverInfo.e.lo)} to {format(hoverInfo.e.hi)}
            </div>
          )}
          {hoverInfo.f && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: colors.forecast }} />
                  Forecast
                </span>
                <b className="tabular font-semibold">{format(hoverInfo.f.value)}</b>
              </div>
              {hoverInfo.f.lo !== undefined && hoverInfo.f.hi !== undefined && (
                <div className={['tabular mt-0.5', night ? 'text-night-ink/60' : 'text-faint'].join(' ')}>
                  Likely {format(hoverInfo.f.lo)} to {format(hoverInfo.f.hi)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** History as a line with a soft area, forecast as a dashed iris line */
export const AreaLine = memo(TimeChartBase);

/** Presagio-style cone of uncertainty: same chart, read as "where it goes next" */
export const Cone = memo(function Cone(props: TimeChartProps) {
  return <TimeChartBase {...props} />;
});

export default AreaLine;

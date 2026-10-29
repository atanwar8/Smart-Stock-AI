'use client';

// Hand-made SVG sample-prediction chart: history (basil), hold-out backtest (actual dots vs predicted ticks),
// forecast (iris, dashed) inside a cone of uncertainty, a "today" divider and the applied forecast as a faint
// reference. A *sample* looks provisional (ghosted, marching dashes, a slow sheen); once applied it settles
// into a solid line. Loaded lazily by PredictionsTab (next/dynamic) so its code stays out of the first chunk.

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { buildGeometry, nearestTarget, type ChartData, type Geometry, type HoverTarget } from './chartGeometry';
import { cx, fullDate, money, shortDate } from './format';
import s from './studio.module.css';

export type ChartState = 'sample' | 'applied';

export interface ForecastChartProps {
  data: ChartData;
  state: ChartState;
  /** Changes for every new sample, which replays the reveal animation */
  revealKey: string;
  unit: string;
  confidence: number;
  /** Accessible one-line summary of what the chart shows */
  label: string;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const lastReportLabel = (iso: string) => {
  const days = (Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000;
  return days < 10 ? 'TODAY' : `LAST REPORT · ${shortDate(iso).toUpperCase()}`;
};

// Static layers: only re-render when geometry or state changes, never on hover
const Layers = memo(function Layers({ geo, state, revealKey, uid }: { geo: Geometry; state: ChartState; revealKey: string; uid: string }) {
  const { plot } = geo;
  const applied = state === 'applied';
  let todayLabel: { text: string; flipped: boolean } | null = null;
  if (geo.today) {
    const room = plot.right - geo.today.x;
    const full = lastReportLabel(geo.today.date);
    const short = full === 'TODAY' ? full : shortDate(geo.today.date).toUpperCase();
    todayLabel = room > full.length * 6.6 + 8 ? { text: full, flipped: false } : room > short.length * 6.6 + 8 ? { text: short, flipped: false } : { text: short, flipped: true };
  }
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}-cone`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-forecast)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--color-forecast)" stopOpacity="0.14" />
        </linearGradient>
        <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="50%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${uid}-cone-clip`}>
          <path d={geo.cone} />
        </clipPath>
        <clipPath id={`${uid}-reveal`}>
          <rect key={revealKey} className={s.reveal} x={geo.forecastStartX - 2} y={0} width={Math.max(0, geo.width - geo.forecastStartX + 2)} height={geo.height} />
        </clipPath>
      </defs>

      {/* grid + y labels */}
      <g>
        {geo.yTicks.map((t) => (
          <g key={t.label}>
            <line x1={plot.left} x2={plot.right} y1={t.y} y2={t.y} stroke="var(--color-line)" strokeWidth={1} />
            <text x={plot.left - 8} y={t.y} dy="0.32em" textAnchor="end" className="fill-faint font-mono text-[10.5px] tabular">
              {t.label}
            </text>
          </g>
        ))}
      </g>

      {/* hold-out window */}
      {geo.holdout && (
        <g>
          <rect x={geo.holdout.x0} y={plot.top} width={geo.holdout.x1 - geo.holdout.x0} height={plot.bottom - plot.top} rx={8} fill="var(--color-well)" />
          {!todayLabel?.flipped && (
            <text x={(geo.holdout.x0 + geo.holdout.x1) / 2} y={plot.top - 10} textAnchor="middle" className="fill-muted font-mono text-[9.5px] tracking-[0.12em]">
              HOLD-OUT
            </text>
          )}
        </g>
      )}

      {/* today divider: label sits right of the line, over the forecast, unless there is no room */}
      {geo.today && todayLabel && (
        <g>
          <line x1={geo.today.x} x2={geo.today.x} y1={plot.top - 2} y2={plot.bottom} stroke="var(--color-line-2)" strokeDasharray="3 4" />
          <text
            x={geo.today.x + (todayLabel.flipped ? -6 : 6)}
            y={plot.top - 10}
            textAnchor={todayLabel.flipped ? 'end' : 'start'}
            className="fill-muted font-mono text-[9.5px] tracking-[0.12em]"
          >
            {todayLabel.text}
          </text>
        </g>
      )}

      {/* history */}
      <path d={geo.historyArea} fill={`url(#${uid}-area)`} />
      <path d={geo.historyLine} fill="none" stroke="var(--color-accent)" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />

      {/* every model's sample, muted, when comparing */}
      {geo.compare.map((c) => (
        <path key={c.id} d={c.d} fill="none" stroke={c.color} strokeWidth={1.5} strokeLinecap="round" opacity={0.9} />
      ))}

      {/* the applied forecast, as a faint reference */}
      {geo.activeLine && (
        <g opacity={0.42}>
          <path d={geo.activeLine} fill="none" stroke="var(--color-ink)" strokeWidth={1.5} strokeDasharray="1.5 4" strokeLinecap="round" />
          {geo.activeEnd && (
            <text x={geo.activeEnd.x - 6} y={geo.activeEnd.y - 8} textAnchor="end" className="fill-ink font-mono text-[9.5px] tracking-[0.1em]">
              APPLIED
            </text>
          )}
        </g>
      )}

      {/* the forecast + cone */}
      {geo.cone && (
        <g clipPath={`url(#${uid}-reveal)`}>
          <g style={{ opacity: applied ? 1 : 0.62, transition: 'opacity 0.42s var(--ease-spring)' }}>
            <path d={geo.cone} fill={`url(#${uid}-cone)`} />
            {!applied && (
              <g clipPath={`url(#${uid}-cone-clip)`}>
                <rect className={s.sheen} x={geo.forecastStartX} y={plot.top} width={(plot.right - geo.forecastStartX) * 0.5} height={plot.bottom - plot.top} fill={`url(#${uid}-sheen)`} />
              </g>
            )}
            <path d={geo.cone} fill="none" stroke="var(--color-forecast)" strokeOpacity={applied ? 0.35 : 0.22} strokeWidth={1} />
          </g>
          <path
            key={applied ? `solid-${revealKey}` : `sample-${revealKey}`}
            d={geo.forecastLine}
            fill="none"
            stroke="var(--color-forecast)"
            strokeWidth={applied ? 2.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={applied ? 1 : undefined}
            className={applied ? s.draw : s.march}
            opacity={applied ? 1 : 0.85}
          />
          {geo.forecastEnd && (
            <g>
              {applied && <circle key={`ping-${revealKey}`} className={s.ping} cx={geo.forecastEnd.x} cy={geo.forecastEnd.y} r={5} fill="var(--color-forecast)" />}
              <circle cx={geo.forecastEnd.x} cy={geo.forecastEnd.y} r={4.5} fill={applied ? 'var(--color-forecast)' : 'var(--color-surface)'} stroke="var(--color-forecast)" strokeWidth={2} />
              <text x={geo.forecastEnd.x - 9} y={geo.forecastEnd.y - 10} textAnchor="end" className="fill-forecast font-mono text-[11px] font-semibold tabular">
                {geo.forecastEnd.label}
              </text>
            </g>
          )}
        </g>
      )}

      {/* hold-out: what the model said (ticks) vs what happened (dots) */}
      {geo.backtest.map((b) => (
        <g key={b.x}>
          {b.yActual !== null && (
            <line x1={b.x} x2={b.x} y1={b.yActual} y2={b.yPredicted} stroke="var(--color-forecast)" strokeOpacity={0.45} strokeWidth={1} />
          )}
          <line x1={b.x - 5} x2={b.x + 5} y1={b.yPredicted} y2={b.yPredicted} stroke="var(--color-forecast)" strokeWidth={2} strokeLinecap="round" />
          {/* no USDA report that week: the prediction tick stays, but there is no real price to compare */}
          {b.yActual !== null && (
            <circle cx={b.x} cy={b.yActual} r={3.4} fill={b.inside ? 'var(--color-accent)' : 'var(--color-warn)'} stroke="var(--color-surface)" strokeWidth={1.5} />
          )}
        </g>
      ))}

      {/* x labels */}
      <g>
        {geo.xTicks.map((t) => (
          <text key={t.x} x={t.x} y={plot.bottom + 18} textAnchor="middle" className="fill-faint font-mono text-[10.5px]">
            {t.label}
          </text>
        ))}
      </g>
    </>
  );
});

function describe(t: HoverTarget, unit: string, confidence: number): { title: string; rows: { label: string; value: string; color?: string }[] } {
  const rows: { label: string; value: string; color?: string }[] = [];
  const conf = `${Math.round(confidence * 100)}% range`;
  if (t.predicted !== undefined && t.actual !== undefined) {
    rows.push({ label: 'Actual', value: money(t.actual) + unit, color: 'var(--color-accent)' });
    rows.push({ label: 'Model said', value: money(t.predicted), color: 'var(--color-forecast)' });
    rows.push({ label: 'Miss', value: money(Math.abs(t.actual - t.predicted)) });
  } else if (t.actual !== undefined) {
    rows.push({ label: 'Actual', value: money(t.actual) + unit, color: 'var(--color-accent)' });
  }
  if (t.yhat !== undefined) {
    rows.push({ label: 'Forecast', value: money(t.yhat) + unit, color: 'var(--color-forecast)' });
    if (t.range) rows.push({ label: conf, value: `${money(t.range[0])} – ${money(t.range[1])}` });
  }
  if (t.applied !== undefined) rows.push({ label: 'Applied', value: money(t.applied), color: 'var(--color-ink)' });
  for (const c of t.compare) rows.push({ label: c.name, value: money(c.value), color: c.color });
  const kind = t.predicted !== undefined ? ' · hold-out' : t.yhat !== undefined || t.applied !== undefined ? ' · forecast' : '';
  return { title: `${fullDate(t.date)}${kind}`, rows };
}

function ForecastChart({ data, state, revealKey, unit, confidence, label }: ForecastChartProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const height = width > 0 && width < 520 ? 250 : 330;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const geo = useMemo(() => (width > 0 ? buildGeometry(data, width, height) : null), [data, width, height]);
  const [hover, setHover] = useState(-1);
  const [announce, setAnnounce] = useState('');

  const target = geo && hover >= 0 ? geo.targets[hover] : null;

  const onPointerMove = useCallback(
    (e: PointerEvent<SVGRectElement>) => {
      if (!geo) return;
      const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
      if (!box) return;
      setHover(nearestTarget(geo.targets, e.clientX - box.left));
    },
    [geo],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!geo || !geo.targets.length) return;
    const last = geo.targets.length - 1;
    let next = hover;
    if (e.key === 'ArrowRight') next = hover < 0 ? 0 : Math.min(last, hover + 1);
    else if (e.key === 'ArrowLeft') next = hover < 0 ? last : Math.max(0, hover - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    setHover(next);
    const d = describe(geo.targets[next], unit, confidence);
    setAnnounce(`${d.title}. ${d.rows.map((r) => `${r.label} ${r.value}`).join(', ')}`);
  };

  const tip = target ? describe(target, unit, confidence) : null;
  const tipWidth = 196;
  const tipLeft = target && geo ? (target.x + 14 + tipWidth > geo.width ? Math.max(4, target.x - 14 - tipWidth) : target.x + 14) : 0;

  return (
    <div
      ref={wrapRef}
      className="relative w-full rounded-tile outline-none focus-visible:ring-2 focus-visible:ring-forecast focus-visible:ring-offset-4 focus-visible:ring-offset-surface"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-roledescription="chart"
      aria-label={`${label} Use the left and right arrow keys to read each week.`}
      onKeyDown={onKeyDown}
      onBlur={() => setHover(-1)}
    >
      {geo && (
        <svg width={geo.width} height={geo.height} viewBox={`0 0 ${geo.width} ${geo.height}`} className="block overflow-visible" aria-hidden>
          <Layers geo={geo} state={state} revealKey={revealKey} uid={uid} />
          {target && (
            <g pointerEvents="none">
              <line x1={target.x} x2={target.x} y1={geo.plot.top} y2={geo.plot.bottom} stroke="var(--color-ink)" strokeOpacity={0.18} />
              {target.dots.map((d, i) => (
                <circle key={i} cx={target.x} cy={d.y} r={4.5} fill="var(--color-surface)" stroke={d.color} strokeWidth={2} />
              ))}
            </g>
          )}
          <rect
            x={geo.plot.left}
            y={0}
            width={Math.max(0, geo.plot.right - geo.plot.left)}
            height={geo.height}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerDown={onPointerMove}
            onPointerLeave={() => setHover(-1)}
          />
        </svg>
      )}

      {tip && target && (
        <div
          className="pointer-events-none absolute z-10 rounded-[12px] border border-line bg-surface/95 px-3 py-2.5 shadow-pop backdrop-blur-sm"
          style={{ left: tipLeft, top: 8, width: tipWidth }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{tip.title}</p>
          <dl className="mt-1.5 space-y-1">
            {tip.rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-2 text-[12px]">
                <dt className="flex min-w-0 items-center gap-1.5 truncate text-muted">
                  {r.color && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />}
                  {r.label}
                </dt>
                <dd className="font-semibold text-ink tabular">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {!geo && <div className={cx('h-full w-full rounded-tile', s.skeleton)} aria-hidden />}
    </div>
  );
}

export default memo(ForecastChart);

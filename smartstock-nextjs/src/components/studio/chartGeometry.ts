// Pure geometry for the sample-prediction chart: scales, smooth paths, ticks and hover targets.
// Kept free of React so ForecastChart can memoize it on (data, width, height) and hover never recomputes it.

import type { BacktestPoint, ForecastPoint, HistoryPoint } from '@/lib/studio';
import { money, parseDay } from './format';

export interface CompareSeries {
  id: string;
  name: string;
  color: string;
  points: ForecastPoint[];
}

export interface ChartData {
  history: HistoryPoint[];
  backtest: BacktestPoint[];
  forecast: ForecastPoint[];
  active: ForecastPoint[] | null;
  compare: CompareSeries[];
}

export interface HoverTarget {
  x: number;
  date: string;
  actual?: number;
  predicted?: number;
  backtestRange?: [number, number];
  yhat?: number;
  range?: [number, number];
  applied?: number;
  compare: { name: string; color: string; value: number }[];
  /** y positions of every value at this date, for the hover dots */
  dots: { y: number; color: string }[];
}

export interface Geometry {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  historyLine: string;
  historyArea: string;
  cone: string;
  forecastLine: string;
  forecastEnd: { x: number; y: number; label: string } | null;
  activeLine: string;
  activeEnd: { x: number; y: number } | null;
  compare: { id: string; color: string; d: string }[];
  backtest: { x: number; yActual: number; yPredicted: number; inside: boolean }[];
  holdout: { x0: number; x1: number } | null;
  today: { x: number; date: string } | null;
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  targets: HoverTarget[];
  /** Horizontal start of the forecast (for the reveal animation) */
  forecastStartX: number;
}

const ACTUAL = 'var(--color-accent)';
const FORECAST = 'var(--color-forecast)';
const APPLIED = 'var(--color-ink)';

const f1 = (v: number) => Math.round(v * 10) / 10;

/** Monotone cubic interpolation (Fritsch–Carlson), the same curve as d3.curveMonotoneX: smooth, never overshoots */
export function smoothPath(points: [number, number][], continueFrom = false): string {
  const n = points.length;
  if (n === 0) return '';
  const start = `${continueFrom ? 'L' : 'M'}${f1(points[0][0])},${f1(points[0][1])}`;
  if (n === 1) return start;
  if (n === 2) return `${start}L${f1(points[1][0])},${f1(points[1][1])}`;

  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0];
    m[i] = dx[i] === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx[i];
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }

  let d = start;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    d += `C${f1(x0 + h)},${f1(y0 + t[i] * h)} ${f1(x1 - h)},${f1(y1 - t[i + 1] * h)} ${f1(x1)},${f1(y1)}`;
  }
  return d;
}

function niceStep(range: number, count: number) {
  const raw = range / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit < 1.5 ? 1 : unit < 2.25 ? 2 : unit < 3.5 ? 2.5 : unit < 7.5 ? 5 : 10;
  return nice * power;
}

const MONTH = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: '2-digit' });

export function buildGeometry(data: ChartData, width: number, height: number): Geometry {
  const compact = width < 520;
  const plot = { left: compact ? 40 : 48, right: width - (compact ? 14 : 20), top: 30, bottom: height - 28 };

  // ---- domains ----
  const times: number[] = [];
  const values: number[] = [];
  for (const p of data.history) {
    times.push(parseDay(p.date));
    values.push(p.price);
  }
  for (const b of data.backtest) {
    times.push(parseDay(b.date));
    values.push(b.actual, b.predicted, b.lo, b.hi);
  }
  for (const f of data.forecast) {
    times.push(parseDay(f.date));
    values.push(f.lo, f.hi, f.yhat);
  }
  for (const f of data.active ?? []) {
    times.push(parseDay(f.date));
    values.push(f.yhat);
  }
  for (const c of data.compare) for (const f of c.points) values.push(f.yhat);

  const t0 = times.length ? Math.min(...times) : 0;
  const t1 = times.length ? Math.max(...times) : 1;
  let v0 = values.length ? Math.min(...values) : 0;
  let v1 = values.length ? Math.max(...values) : 1;
  const mid = (v0 + v1) / 2;
  const minSpan = Math.max(0.1, Math.abs(mid) * 0.12);
  if (v1 - v0 < minSpan) {
    v0 = mid - minSpan / 2;
    v1 = mid + minSpan / 2;
  }
  const pad = (v1 - v0) * 0.1;
  v0 = Math.max(0, v0 - pad);
  v1 = v1 + pad;

  const x = (t: number) => plot.left + ((t - t0) / Math.max(1, t1 - t0)) * (plot.right - plot.left);
  const y = (v: number) => plot.bottom - ((v - v0) / (v1 - v0)) * (plot.bottom - plot.top);
  const xd = (iso: string) => x(parseDay(iso));

  // ---- y ticks ----
  const step = niceStep(v1 - v0, compact ? 3 : 4);
  const yTicks: Geometry['yTicks'] = [];
  for (let v = Math.ceil(v0 / step) * step; v <= v1 + 1e-9; v += step) {
    yTicks.push({ y: y(v), label: money(v, step < 0.1 ? 2 : step < 1 ? 2 : 0) });
  }

  // ---- x ticks: month starts, thinned to keep labels apart ----
  const months: { x: number; t: number }[] = [];
  const first = new Date(t0);
  let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
  while (cursor <= t1) {
    months.push({ x: x(cursor), t: cursor });
    const d = new Date(cursor);
    cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const minGap = compact ? 46 : 54;
  const every = Math.max(1, Math.ceil(minGap / Math.max(1, (plot.right - plot.left) / Math.max(1, months.length))));
  const xTicks = months
    .filter((_, i) => i % every === 0)
    .map((m, i) => ({ x: m.x, label: i === 0 || new Date(m.t).getUTCMonth() === 0 ? MONTH_YEAR.format(m.t).replace(' ', " '") : MONTH.format(m.t) }));

  // ---- real prices ----
  const real = new Map<string, number>();
  for (const p of data.history) real.set(p.date, p.price);
  for (const b of data.backtest) if (!real.has(b.date)) real.set(b.date, b.actual);
  const realPoints = [...real.entries()].sort((a, b) => parseDay(a[0]) - parseDay(b[0]));
  const realXY = realPoints.map(([d, v]) => [xd(d), y(v)] as [number, number]);
  const historyLine = smoothPath(realXY);
  const historyArea = realXY.length > 1 ? `${historyLine}L${f1(realXY[realXY.length - 1][0])},${plot.bottom}L${f1(realXY[0][0])},${plot.bottom}Z` : '';
  const lastReal = realPoints[realPoints.length - 1];

  // ---- forecast: anchored on the last real price so the cone opens from "today" ----
  const anchor: [number, number] | null = lastReal ? [xd(lastReal[0]), y(lastReal[1])] : null;
  const fcXY = data.forecast.map((f) => [xd(f.date), y(f.yhat)] as [number, number]);
  const forecastLine = smoothPath(anchor ? [anchor, ...fcXY] : fcXY);
  let cone = '';
  if (data.forecast.length) {
    const upper = data.forecast.map((f) => [xd(f.date), y(f.hi)] as [number, number]);
    const lower = data.forecast.map((f) => [xd(f.date), y(f.lo)] as [number, number]).reverse();
    cone = `${smoothPath(anchor ? [anchor, ...upper] : upper)}${smoothPath(anchor ? [...lower, anchor] : lower, true)}Z`;
  }
  const lastFc = data.forecast[data.forecast.length - 1];
  const forecastEnd = lastFc ? { x: xd(lastFc.date), y: y(lastFc.yhat), label: money(lastFc.yhat) } : null;

  const activeXY = (data.active ?? []).map((f) => [xd(f.date), y(f.yhat)] as [number, number]);
  const activeLine = smoothPath(anchor && activeXY.length ? [anchor, ...activeXY] : activeXY);
  const activeEnd = activeXY.length ? { x: activeXY[activeXY.length - 1][0], y: activeXY[activeXY.length - 1][1] } : null;

  const compare = data.compare.map((c) => ({
    id: c.id,
    color: c.color,
    d: smoothPath([...(anchor ? [anchor] : []), ...c.points.map((f) => [xd(f.date), y(f.yhat)] as [number, number])]),
  }));

  // ---- hold-out ----
  const backtest = data.backtest.map((b) => ({ x: xd(b.date), yActual: y(b.actual), yPredicted: y(b.predicted), inside: b.actual >= b.lo && b.actual <= b.hi }));
  const weekPx = realXY.length > 1 ? (realXY[realXY.length - 1][0] - realXY[0][0]) / (realXY.length - 1) : 12;
  const holdout = backtest.length ? { x0: Math.max(plot.left, backtest[0].x - weekPx / 2), x1: backtest[backtest.length - 1].x + weekPx / 2 } : null;
  const today = lastReal ? { x: xd(lastReal[0]), date: lastReal[0] } : null;

  // ---- hover targets: one per distinct date ----
  const byDate = new Map<string, HoverTarget>();
  const target = (date: string) => {
    let t = byDate.get(date);
    if (!t) {
      t = { x: xd(date), date, compare: [], dots: [] };
      byDate.set(date, t);
    }
    return t;
  };
  for (const [date, price] of realPoints) {
    const t = target(date);
    t.actual = price;
    t.dots.push({ y: y(price), color: ACTUAL });
  }
  for (const b of data.backtest) {
    const t = target(b.date);
    t.predicted = b.predicted;
    t.backtestRange = [b.lo, b.hi];
    t.dots.push({ y: y(b.predicted), color: FORECAST });
  }
  for (const f of data.forecast) {
    const t = target(f.date);
    t.yhat = f.yhat;
    t.range = [f.lo, f.hi];
    t.dots.push({ y: y(f.yhat), color: FORECAST });
  }
  for (const f of data.active ?? []) {
    const t = target(f.date);
    t.applied = f.yhat;
    t.dots.push({ y: y(f.yhat), color: APPLIED });
  }
  for (const c of data.compare) {
    for (const f of c.points) {
      const t = target(f.date);
      t.compare.push({ name: c.name, color: c.color, value: f.yhat });
      t.dots.push({ y: y(f.yhat), color: c.color });
    }
  }
  const targets = [...byDate.values()].sort((a, b) => a.x - b.x);

  return {
    width,
    height,
    plot,
    historyLine,
    historyArea,
    cone,
    forecastLine,
    forecastEnd,
    activeLine,
    activeEnd,
    compare,
    backtest,
    holdout,
    today,
    yTicks,
    xTicks,
    targets,
    forecastStartX: anchor ? anchor[0] : plot.left,
  };
}

/** Index of the target nearest to a pixel x (binary search over sorted targets) */
export function nearestTarget(targets: HoverTarget[], px: number) {
  if (!targets.length) return -1;
  let lo = 0;
  let hi = targets.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (targets[mid].x < px) lo = mid;
    else hi = mid;
  }
  return Math.abs(targets[lo].x - px) <= Math.abs(targets[hi].x - px) ? lo : hi;
}

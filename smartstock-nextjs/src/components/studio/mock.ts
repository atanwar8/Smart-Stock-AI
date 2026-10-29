// Dev-only stand-in for the /forecast/* API (docs/handoff/SPEC.md §5).
// Loaded by lib/studio.ts through a dynamic import only when NEXT_PUBLIC_STUDIO_MOCK=1, so it never ships
// in a production bundle. Numbers are synthetic but deterministic per commodity + model, shaped like the
// real store (weekly USDA report dates, 2023-07-28 -> 2025-07-25) and with realistic latencies.

import type {
  ActiveForecast,
  ActiveResponse,
  ApplyResult,
  BacktestPoint,
  ForecastPoint,
  HistoryPoint,
  Leaderboard,
  LeaderboardRow,
  ModelsResponse,
  Preview,
  PreviewMetrics,
  PreviewRequest,
  StudioModel,
} from '@/lib/studio';

const FIRST_REPORT = Date.UTC(2023, 6, 28);
const STORE_WEEKS = 105;
const TEST_WEEKS = 8;
const WEEK = 7 * 86_400_000;

const MODELS: StudioModel[] = [
  { id: 'ensemble', name: 'Ensemble', family: 'Weighted blend', available: true, mode: 'live', reason: null, speed: 'medium', blurb: 'Blends the three best models on past weeks, weighted by how accurate each one was.' },
  { id: 'lightgbm', name: 'LightGBM', family: 'Gradient-boosted trees', available: true, mode: 'live', reason: null, speed: 'fast', blurb: 'Learns from recent weeks and the calendar; quick and sharp on steady items.' },
  { id: 'ets', name: 'ETS (damped)', family: 'Exponential smoothing', available: true, mode: 'live', reason: null, speed: 'fast', blurb: 'Trusts recent weeks most and lets a trend fade instead of running away.' },
  { id: 'theta', name: 'Theta', family: 'Trend + smoothing', available: true, mode: 'live', reason: null, speed: 'fast', blurb: 'A long-run trend line blended with a short-run smoother. A sturdy classic.' },
  { id: 'seasonal_naive', name: 'Seasonal naive', family: 'Baseline', available: true, mode: 'live', reason: null, speed: 'fast', blurb: 'Repeats the price from the same week last season. Every model has to beat it.' },
  { id: 'prophet', name: 'Prophet', family: 'Trend + seasonality curves', available: false, mode: 'unavailable', reason: 'Not installed on this server.', speed: 'medium', blurb: 'Curve-fitting model with yearly seasonality.' },
];

// Relative hold-out error vs the seasonal-naive baseline (lower is better)
const QUALITY: Record<string, number> = { seasonal_naive: 1, ets: 0.87, theta: 0.9, lightgbm: 0.84, ensemble: 0.8 };
const LATENCY: Record<string, [number, number]> = { fast: [450, 300], medium: [900, 400], slow: [1700, 900] };

const PRICES: [RegExp, number, string][] = [
  [/tomat/i, 2.1, 'per lb'],
  [/lettuce/i, 1.85, 'each'],
  [/carrot/i, 1.15, 'per lb'],
  [/broccoli/i, 2.45, 'per lb'],
  [/cucumber/i, 0.9, 'each'],
  [/cauliflower/i, 3.2, 'each'],
  [/cabbage/i, 0.82, 'per lb'],
  [/asparagus/i, 3.95, 'per lb'],
  [/sweet potato/i, 1.3, 'per lb'],
  [/onion/i, 0.95, 'each'],
  [/pepper/i, 2.6, 'per lb'],
];

// ---------- deterministic randomness ----------

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

// Two-sided normal quantile for the confidence levels the studio allows (0.50 ... 0.95)
const Z: [number, number][] = [
  [0.5, 0.674], [0.55, 0.755], [0.6, 0.842], [0.65, 0.935], [0.7, 1.036],
  [0.75, 1.15], [0.8, 1.282], [0.85, 1.44], [0.9, 1.645], [0.95, 1.96],
];
function zFor(confidence: number) {
  const c = Math.min(0.95, Math.max(0.5, confidence));
  for (let i = 1; i < Z.length; i++) {
    if (c <= Z[i][0]) {
      const [c0, z0] = Z[i - 1];
      const [c1, z1] = Z[i];
      return z0 + ((c - c0) / (c1 - c0)) * (z1 - z0);
    }
  }
  return 1.96;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const cents = (v: number) => Math.round(v * 100) / 100;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function abortError() {
  return new DOMException('The request was cancelled', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

// ---------- synthetic store ----------

interface Series {
  commodity: string;
  unit: string;
  base: number;
  amp: number;
  phase: number;
  points: HistoryPoint[];
}

const seriesCache = new Map<string, Series>();

function seriesFor(commodity: string): Series {
  const cached = seriesCache.get(commodity);
  if (cached) return cached;
  const match = PRICES.find(([re]) => re.test(commodity));
  const base = match?.[1] ?? 1.6;
  const unit = match?.[2] ?? 'per lb';
  const r = rng(hash(commodity));
  const amp = 0.07 + r() * 0.1;
  const phase = r() * Math.PI * 2;
  const drift = (r() - 0.45) * 0.0012;
  let ar = 0;
  const points: HistoryPoint[] = [];
  for (let i = 0; i < STORE_WEEKS; i++) {
    ar = 0.72 * ar + gauss(r) * 0.026;
    const price = base * (1 + amp * Math.sin((2 * Math.PI * i) / 52 + phase) + ar) * (1 + drift * i);
    points.push({ date: iso(FIRST_REPORT + i * WEEK), price: cents(Math.max(0.2, price)) });
  }
  const series = { commodity, unit, base, amp, phase, points };
  seriesCache.set(commodity, series);
  return series;
}

function storeWeeks(historyYears: number | null) {
  return historyYears === null ? STORE_WEEKS : Math.min(STORE_WEEKS, Math.round(historyYears * 52));
}

// Hold-out predictions for one model; the errors depend only on commodity + model, the interval on confidence
function backtestFor(series: Series, model: string, confidence: number, weeks: number) {
  const r = rng(hash(`${series.commodity}:${model}:bt`));
  const jitter = 0.92 + r() * 0.16;
  const shortHistory = weeks < 60 ? 1.12 : 1;
  const sigma = series.base * 0.05 * (QUALITY[model] ?? 0.9) * jitter * shortHistory;
  const z = zFor(confidence);
  const actuals = series.points.slice(-TEST_WEEKS);
  const rows: BacktestPoint[] = actuals.map((p, k) => {
    const predicted = p.price + gauss(r) * sigma * (1 + k * 0.04);
    const half = z * sigma * 1.08 * Math.sqrt(1 + k * 0.08);
    return { date: p.date, actual: p.price, predicted: cents(predicted), lo: cents(predicted - half), hi: cents(predicted + half) };
  });
  return { rows, sigma };
}

function metricsFor(series: Series, rows: BacktestPoint[], weeks: number): PreviewMetrics & { rmse: number; smape: number } {
  const errors = rows.map((b) => Math.abs(b.actual - b.predicted));
  const mae = mean(errors);
  const train = series.points.slice(-weeks, -TEST_WEEKS);
  const naiveInSample = mean(train.slice(1).map((p, i) => Math.abs(p.price - train[i].price))) || 0.01;
  const baseline = mean(backtestFor(series, 'seasonal_naive', 0.8, weeks).rows.map((b) => Math.abs(b.actual - b.predicted))) || 0.01;
  return {
    mae: Math.round(mae * 1000) / 1000,
    rmse: Math.round(Math.sqrt(mean(errors.map((e) => e * e))) * 1000) / 1000,
    mape: Math.round(mean(rows.map((b) => Math.abs(b.actual - b.predicted) / b.actual)) * 1000) / 10,
    smape: Math.round(mean(rows.map((b) => (2 * Math.abs(b.actual - b.predicted)) / (b.actual + b.predicted))) * 1000) / 10,
    mase: Math.round((mae / naiveInSample) * 100) / 100,
    coverage: Math.round((rows.filter((b) => b.actual >= b.lo && b.actual <= b.hi).length / rows.length) * 100) / 100,
    skill: Math.round((1 - mae / baseline) * 100) / 100,
  };
}

function forecastFor(series: Series, req: PreviewRequest, sigma: number): ForecastPoint[] {
  const r = rng(hash(`${series.commodity}:${req.model}:fc`));
  const bias = (r() - 0.5) * 0.006 * series.base;
  const z = zFor(req.confidence);
  const n = series.points.length;
  const last = series.points[n - 1];
  const lastMs = Date.parse(`${last.date}T00:00:00Z`);
  const wave = (i: number) => series.base * series.amp * Math.sin((2 * Math.PI * i) / 52 + series.phase);
  const out: ForecastPoint[] = [];
  for (let k = 1; k <= req.horizon_weeks; k++) {
    const base = last.price + (wave(n - 1 + k) - wave(n - 1)) * (req.model === 'seasonal_naive' ? 1.1 : 0.85) + bias * k;
    const yhat = base * (1 + (req.pace_pct / 100) * (k / req.horizon_weeks));
    const half = z * sigma * Math.sqrt(k) * 0.9;
    out.push({ date: iso(lastMs + k * WEEK), yhat: cents(yhat), lo: cents(Math.max(0.05, yhat - half)), hi: cents(yhat + half) });
  }
  return out;
}

function money(v: number) {
  return `$${v.toFixed(2)}`;
}

function summarize(commodity: string, unit: string, last: number, forecast: ForecastPoint[], confidence: number) {
  const end = forecast[forecast.length - 1];
  const change = ((end.yhat - last) / last) * 100;
  const weeks = forecast.length === 1 ? 'next week' : `next ${forecast.length} weeks`;
  const range = `${Math.round(confidence * 100)}% range ${money(end.lo)}–${money(end.hi)} ${unit}`;
  if (Math.abs(change) < 1) return `${commodity} likely hold near ${money(end.yhat)} over the ${weeks}; ${range}.`;
  const verb = change < 0 ? 'ease' : 'climb';
  return `${commodity} likely ${verb} about ${Math.abs(Math.round(change))}% over the ${weeks}; ${range}.`;
}

function uuid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

// ---------- in-memory "forecasts" table ----------

const previews = new Map<string, { preview: Preview; status: 'preview' | 'applied' | 'superseded' }>();
const applied = new Map<string, ActiveForecast>();

function buildPreview(req: PreviewRequest): Preview {
  const series = seriesFor(req.commodity);
  const model = MODELS.find((m) => m.id === req.model);
  const weeks = storeWeeks(req.history_years);
  const { rows, sigma } = backtestFor(series, req.model, req.confidence, weeks);
  const metrics = metricsFor(series, rows, weeks);
  const forecast = forecastFor(series, req, sigma);
  const historyLength = Math.max(26, 2 * req.horizon_weeks);
  const history = series.points.slice(-historyLength);
  const start = series.points[series.points.length - weeks];
  const unitWord = series.unit;
  return {
    preview_id: uuid(),
    commodity: req.commodity,
    unit: unitWord,
    model: req.model,
    model_name: model?.name ?? req.model,
    mode: model?.mode ?? 'live',
    params: { horizon_weeks: req.horizon_weeks, confidence: req.confidence, history_years: req.history_years, pace_pct: req.pace_pct },
    history,
    backtest: rows,
    forecast,
    metrics: { mae: metrics.mae, mape: metrics.mape, mase: metrics.mase, coverage: metrics.coverage, skill: metrics.skill },
    summary: summarize(req.commodity, unitWord, history[history.length - 1].price, forecast, req.confidence),
    train_window: { start: start.date, end: series.points[series.points.length - 1].date, weeks },
    elapsed_ms: 0,
    generated_at: new Date().toISOString(),
  };
}

function seedActive(commodity: string) {
  if (applied.has(commodity) || !/tomat/i.test(commodity)) return;
  // One forecast was "applied yesterday" so the reference line and the Active chip have something to show
  const p = buildPreview({ commodity, model: 'ensemble', horizon_weeks: 8, confidence: 0.8, history_years: 2, pace_pct: 0 });
  applied.set(commodity, {
    forecast_id: uuid(),
    commodity,
    unit: p.unit,
    model: p.model,
    model_name: p.model_name,
    applied_at: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    params: p.params,
    forecast: p.forecast.map((f) => ({ ...f, yhat: cents(f.yhat * 1.03), lo: cents(f.lo * 1.03), hi: cents(f.hi * 1.03) })),
    summary: p.summary,
  });
}

// ---------- the API ----------

export async function models(signal?: AbortSignal): Promise<ModelsResponse> {
  await sleep(320, signal);
  return { default: 'ensemble', models: MODELS };
}

export async function leaderboard(commodity: string, signal?: AbortSignal): Promise<Leaderboard> {
  await sleep(480, signal);
  const series = seriesFor(commodity);
  const weeks = storeWeeks(2);
  const scored = MODELS.filter((m) => m.available).map((m) => {
    const { rows } = backtestFor(series, m.id, 0.8, weeks);
    return { m, metrics: metricsFor(series, rows, weeks) };
  });
  scored.sort((a, b) => a.metrics.mae - b.metrics.mae);
  const rows: LeaderboardRow[] = scored.map(({ m, metrics }, i) => ({
    model: m.id,
    name: m.name,
    mae: metrics.mae,
    rmse: metrics.rmse,
    mape: metrics.mape,
    smape: metrics.smape,
    mase: metrics.mase,
    coverage: metrics.coverage,
    skill: metrics.skill,
    rank: i + 1,
  }));
  const points = series.points;
  return {
    commodity,
    unit: series.unit,
    train_start: points[points.length - weeks].date,
    train_end: points[points.length - TEST_WEEKS - 1].date,
    test_start: points[points.length - TEST_WEEKS].date,
    test_end: points[points.length - 1].date,
    test_weeks: TEST_WEEKS,
    champion: rows[0].model,
    updated_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    rows,
  };
}

export async function preview(req: PreviewRequest, signal?: AbortSignal): Promise<Preview> {
  const model = MODELS.find((m) => m.id === req.model);
  if (!model) throw new Error(`404: Unknown model "${req.model}"`);
  if (!model.available) throw new Error(`409: ${model.name} is unavailable: ${model.reason}`);
  const [floor, spread] = LATENCY[model.speed] ?? LATENCY.medium;
  const wait = floor + Math.random() * spread;
  const started = performance.now();
  await sleep(wait, signal);
  const p = buildPreview(req);
  p.elapsed_ms = Math.round(performance.now() - started);
  previews.set(p.preview_id, { preview: p, status: 'preview' });
  return p;
}

export async function apply(previewId: string): Promise<ApplyResult> {
  await sleep(520);
  const row = previews.get(previewId);
  if (!row) throw new Error('404: Preview not found');
  if (row.status === 'superseded') throw new Error('409: This preview was already superseded');
  const p = row.preview;
  const previous = applied.get(p.commodity);
  for (const other of previews.values()) {
    if (other !== row && other.status === 'applied' && other.preview.commodity === p.commodity) other.status = 'superseded';
  }
  row.status = 'applied';
  const appliedAt = new Date().toISOString();
  const forecastId = uuid();
  applied.set(p.commodity, {
    forecast_id: forecastId,
    commodity: p.commodity,
    unit: p.unit,
    model: p.model,
    model_name: p.model_name,
    applied_at: appliedAt,
    params: p.params,
    forecast: p.forecast,
    summary: p.summary,
  });
  return { applied: true, forecast_id: forecastId, commodity: p.commodity, applied_at: appliedAt, superseded: previous?.forecast_id ?? null };
}

export async function active(commodity?: string, signal?: AbortSignal): Promise<ActiveResponse> {
  await sleep(260, signal);
  if (commodity) seedActive(commodity);
  const items = [...applied.values()].filter((a) => !commodity || a.commodity === commodity);
  return { items };
}


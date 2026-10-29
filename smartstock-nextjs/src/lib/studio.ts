// Typed client for the Forecast Studio API (docs/handoff/SPEC.md §5).
// Paths are relative to API_BASE ("/api"), same as every other call in the app.
// With NEXT_PUBLIC_STUDIO_MOCK=1 (dev only) the calls are answered by components/studio/mock.ts instead,
// so the studio can be built and demoed before the backend endpoints exist.

import { getJSON, postJSON } from '@/lib/api';

export type ModelMode = 'live' | 'stored' | 'unavailable';

export interface StudioModel {
  id: string;
  name: string;
  family: string;
  available: boolean;
  mode: ModelMode;
  reason: string | null;
  /** "fast" | "medium" | "slow" today; kept open so a new value never breaks the UI */
  speed: string;
  blurb: string;
}

export interface ModelsResponse {
  default: string;
  models: StudioModel[];
}

export interface LeaderboardRow {
  model: string;
  name: string;
  mae: number;
  rmse: number;
  mape: number;
  smape: number;
  mase: number;
  coverage: number;
  skill: number;
  rank: number;
}

export interface Leaderboard {
  commodity: string;
  unit: string;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  test_weeks: number;
  champion: string;
  updated_at: string;
  rows: LeaderboardRow[];
}

export interface PreviewParams {
  horizon_weeks: number;
  confidence: number;
  /** null = everything stored */
  history_years: number | null;
  pace_pct: number;
}

export interface PreviewRequest extends PreviewParams {
  commodity: string;
  model: string;
}

export interface HistoryPoint {
  date: string;
  price: number;
}

export interface BacktestPoint {
  date: string;
  actual: number;
  predicted: number;
  lo: number;
  hi: number;
}

export interface ForecastPoint {
  date: string;
  yhat: number;
  lo: number;
  hi: number;
}

export interface PreviewMetrics {
  mae: number;
  mape: number;
  mase: number;
  coverage: number;
  skill: number;
}

export interface Preview {
  preview_id: string;
  commodity: string;
  unit: string;
  model: string;
  model_name: string;
  mode: ModelMode;
  params: PreviewParams;
  history: HistoryPoint[];
  backtest: BacktestPoint[];
  forecast: ForecastPoint[];
  metrics: PreviewMetrics;
  summary: string;
  train_window: { start: string; end: string; weeks: number };
  elapsed_ms: number;
  generated_at: string;
}

export interface ApplyResult {
  applied: boolean;
  forecast_id: string;
  commodity: string;
  applied_at: string;
  superseded: string | null;
}

export interface ActiveForecast {
  forecast_id: string;
  commodity: string;
  unit: string;
  model: string;
  model_name: string;
  applied_at: string;
  params: PreviewParams;
  forecast: ForecastPoint[];
  summary: string;
}

export interface ActiveResponse {
  items: ActiveForecast[];
}

// ---------- knobs (bounds from SPEC §5) ----------

export const HORIZON = { min: 1, max: 26, ticks: [4, 8, 13, 26] } as const;
export const CONFIDENCE = { min: 50, max: 95, step: 5 } as const;
/** History snaps in years; null = all stored weeks */
export const HISTORY_SNAPS: readonly (number | null)[] = [1, 2, 3, 5, null];
export const PACE = { min: -40, max: 60 } as const;

export const DEFAULT_PARAMS: PreviewParams = { horizon_weeks: 8, confidence: 0.8, history_years: 2, pace_pct: 0 };

// ---------- transport ----------

/** True when the dev mock answers instead of the backend (shown as a small badge in the UI) */
export const STUDIO_MOCK = process.env.NEXT_PUBLIC_STUDIO_MOCK === '1';

type MockModule = typeof import('@/components/studio/mock');

// The env check is inlined at the only import() site so production builds drop the mock chunk entirely.
function viaMock<T>(answer: (mock: MockModule) => Promise<T>): Promise<T> | null {
  if (process.env.NEXT_PUBLIC_STUDIO_MOCK === '1') return import('@/components/studio/mock').then(answer);
  return null;
}

const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const fetchModels = (signal?: AbortSignal) =>
  viaMock((m) => m.models(signal)) ?? getJSON<ModelsResponse>('/forecast/models', { signal });

export const fetchLeaderboard = (commodity: string, signal?: AbortSignal) =>
  viaMock((m) => m.leaderboard(commodity, signal)) ?? getJSON<Leaderboard>(`/forecast/leaderboard${qs({ commodity })}`, { signal });

export const fetchActive = (commodity?: string, signal?: AbortSignal) =>
  viaMock((m) => m.active(commodity, signal)) ?? getJSON<ActiveResponse>(`/forecast/active${qs({ commodity })}`, { signal });

// postJSON has no abort hook, so previews go through getJSON with a POST init to stay cancellable.
export const previewForecast = (request: PreviewRequest, signal?: AbortSignal) =>
  viaMock((m) => m.preview(request, signal)) ??
  getJSON<Preview>('/forecast/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

export const applyForecast = (previewId: string) =>
  viaMock((m) => m.apply(previewId)) ?? postJSON<ApplyResult>('/forecast/apply', { preview_id: previewId });

// ---------- errors + cancellation ----------

/** getJSON throws "404: detail"; this pulls the HTTP status back out (null for network errors) */
export function errorStatus(error: unknown): number | null {
  const match = /^(\d{3}):/.exec(error instanceof Error ? error.message : '');
  return match ? Number(match[1]) : null;
}

export function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\d{3}:\s*/, '');
}

export const isAbortError = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError';

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Keeps only the newest request alive: starting one aborts the one in flight, and a result that
 * arrives after it was superseded resolves to null, so results can never land out of order.
 */
export class LatestOnly {
  private controller: AbortController | null = null;
  private seq = 0;

  async run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<Settled<T> | null> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const id = ++this.seq;
    try {
      const value = await task(controller.signal);
      return id === this.seq ? { ok: true, value } : null;
    } catch (error) {
      if (id !== this.seq || isAbortError(error)) return null;
      return { ok: false, error };
    } finally {
      if (id === this.seq) this.controller = null;
    }
  }

  cancel() {
    this.seq++;
    this.controller?.abort();
    this.controller = null;
  }
}

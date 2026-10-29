'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, getJSON, postJSON, qs } from './api';
import type { IngestRun, Page, PipelineStatus, PipelineStep } from './types';

// Typed client for the Supabase training pipeline (docs/handoff/SPEC.md §5, /pipeline/*).

export const PIPELINE_STEPS: { id: Exclude<PipelineStep, 'done'>; title: string; detail: string }[] = [
  { id: 'extract', title: 'Extract', detail: 'Ask USDA MyMarketNews for every week after the newest stored one' },
  { id: 'load', title: 'Load', detail: 'Upsert into the store; corrected weeks replace old rows, nothing is deleted' },
  { id: 'train', title: 'Train', detail: 'Refit each model on all stored weeks, so old data never drops out' },
  { id: 'test', title: 'Test', detail: 'Hold out the newest weeks, score every model, crown a champion' },
];

export const getPipelineStatus = () => getJSON<PipelineStatus>('/pipeline/status');

export const getPipelineRuns = (limit = 10, offset = 0) => getJSON<Page<IngestRun>>(`/pipeline/runs?${qs({ limit, offset })}`);

/** Starts a refresh. A 409 means one is already running, which is the same outcome for the UI. */
export async function startPipelineRefresh(): Promise<{ job_id?: string; state: string; alreadyRunning?: boolean }> {
  try {
    return await postJSON<{ job_id: string; state: string }>('/pipeline/refresh');
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { state: 'running', alreadyRunning: true };
    throw err;
  }
}

/** Progress may arrive as 0..1 or 0..100; always hand back 0..1 */
export const progressFraction = (p?: number) => {
  if (p === undefined || p === null || Number.isNaN(p)) return 0;
  return Math.max(0, Math.min(1, p > 1 ? p / 100 : p));
};

export interface PipelineState {
  status?: PipelineStatus;
  /** First load still in flight */
  loading: boolean;
  /** The server answered 404: an older backend without the pipeline routes */
  unavailable: boolean;
  error?: string;
  reload: () => void;
}

// Status is fetched once, then every `fastMs` while a run is in progress (and every `slowMs` otherwise,
// so a refresh started elsewhere, e.g. at server start, still shows up). Polling pauses in a hidden tab.
export function usePipelineStatus(fastMs = 1500, slowMs = 30000): PipelineState {
  const [status, setStatus] = useState<PipelineStatus>();
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const running = status?.state === 'running';

  useEffect(() => {
    // Each run of this effect owns its own loop; `cancelled` stops a request that lands after cleanup
    // from scheduling a second, orphaned loop.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const next = await getPipelineStatus();
          if (cancelled) return;
          setStatus(next);
          setUnavailable(false);
          setError(undefined);
        } catch (err) {
          if (cancelled) return;
          if (err instanceof ApiError && err.status === 404) setUnavailable(true);
          else setError((err as Error).message);
        }
        setLoading(false);
      }
      if (!cancelled) timer = setTimeout(tick, running ? fastMs : slowMs);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running, fastMs, slowMs, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { status, loading, unavailable, error, reload };
}

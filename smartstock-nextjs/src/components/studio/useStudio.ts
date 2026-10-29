'use client';

// All Forecast Studio state in one hook: models, leaderboard and applied forecast per produce, the knobs,
// the current sample (debounced + cancellable), compare lines and the apply flow.
// Callbacks are stable (refs inside) so memoized children don't re-render while a slider moves.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PARAMS,
  LatestOnly,
  applyForecast,
  errorDetail,
  errorStatus,
  fetchActive,
  fetchLeaderboard,
  fetchModels,
  isAbortError,
  previewForecast,
  type ActiveForecast,
  type HistoryPoint,
  type Leaderboard,
  type ModelsResponse,
  type Preview,
  type PreviewParams,
  type PreviewRequest,
} from '@/lib/studio';
import type { CompareSeries } from './chartGeometry';

const DEBOUNCE_MS = 350;
// How often the studio re-asks while the backend is still training its models (503)
const TRAINING_RETRY_MS = 10_000;
const NO_LINES: CompareSeries[] = [];
const COMPARE_COLORS = ['#9a8466', '#6f8fa6', '#a8737d', '#7f8f58', '#8f78b3', '#5f9690', '#b0894f'];

export type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string; code: number | null };

export interface SampleState {
  data: Preview | null;
  loading: boolean;
  /** Model + time of the request in flight, for the loader */
  pending: { model: string; startedAt: number } | null;
  error: { message: string; code: number | null } | null;
  applied: boolean;
  discarded: boolean;
  /** Last real prices seen for this produce, kept when a sample is discarded */
  history: HistoryPoint[];
}

export type ApplyState = { status: 'idle' } | { status: 'applying' } | { status: 'applied' } | { status: 'error'; message: string };

export interface Toast {
  id: number;
  text: string;
}

const EMPTY_SAMPLE: SampleState = { data: null, loading: false, pending: null, error: null, applied: false, discarded: false, history: [] };

function previewError(error: unknown): { message: string; code: number | null } {
  const code = errorStatus(error);
  if (code === null) return { code, message: 'Can’t reach the forecasting service. Check that the backend is running, then try again.' };
  if (code === 404) return { code, message: `Nothing to forecast yet: ${errorDetail(error)}` };
  if (code === 409) return { code, message: `That model can’t run right now: ${errorDetail(error)}` };
  if (code === 422) return { code, message: 'Those settings are outside what the model accepts. Nudge a knob and try again.' };
  // The backend trains every model ahead of time (after a deploy or a data refresh); the studio retries on its own
  if (code === 503) return { code, message: errorDetail(error) };
  return { code, message: `The model stumbled (${code}). Try again, or pick another model.` };
}

function loadError(error: unknown): { status: 'error'; message: string; code: number | null } {
  const code = errorStatus(error);
  const message =
    code === 404
      ? 'The Forecast Studio endpoints aren’t on this server yet.'
      : code === null
        ? 'Can’t reach the forecasting service.'
        : errorDetail(error);
  return { status: 'error', message, code };
}

const sameParams = (a: PreviewParams, b: PreviewParams) =>
  a.horizon_weeks === b.horizon_weeks && Math.abs(a.confidence - b.confidence) < 1e-6 && a.history_years === b.history_years && a.pace_pct === b.pace_pct;

export function useStudio(commodity: string) {
  const [models, setModels] = useState<Load<ModelsResponse>>({ status: 'loading' });
  const [boards, setBoards] = useState<Record<string, Load<Leaderboard>>>({});
  const [actives, setActives] = useState<Record<string, ActiveForecast | null>>({});
  const [modelId, setModelId] = useState<string | null>(null);
  const [params, setParams] = useState<PreviewParams>(DEFAULT_PARAMS);
  const [sample, setSample] = useState<SampleState>(EMPTY_SAMPLE);
  const [compareOn, setCompareOn] = useState(false);
  const [compare, setCompare] = useState<{ commodity: string; lines: CompareSeries[]; loading: boolean }>({ commodity: '', lines: [], loading: false });
  const [apply, setApply] = useState<ApplyState>({ status: 'idle' });
  const [toast, setToast] = useState<Toast | null>(null);
  const [modelsNonce, setModelsNonce] = useState(0);

  const runner = useRef(new LatestOnly());
  const compareRunner = useRef(new LatestOnly());
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ sample, models, compareOn, apply });
  latest.current = { sample, models, compareOn, apply };

  // ---- models (once) ----
  useEffect(() => {
    const controller = new AbortController();
    setModels({ status: 'loading' });
    fetchModels(controller.signal)
      .then((data) => {
        setModels({ status: 'ready', data });
        setModelId((current) => {
          if (current && data.models.some((m) => m.id === current && m.available)) return current;
          const preferred = data.models.find((m) => m.id === data.default && m.available);
          return (preferred ?? data.models.find((m) => m.available))?.id ?? null;
        });
      })
      .catch((error) => !isAbortError(error) && setModels(loadError(error)));
    return () => controller.abort();
  }, [modelsNonce]);

  const retryModels = useCallback(() => setModelsNonce((n) => n + 1), []);

  // ---- leaderboard + applied forecast for the selected produce (cached per produce) ----
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
  const [boardNonce, setBoardNonce] = useState(0);
  useEffect(() => {
    const cached = boardsRef.current[commodity];
    if (cached && cached.status !== 'error') return;
    const controller = new AbortController();
    setBoards((b) => ({ ...b, [commodity]: { status: 'loading' } }));
    fetchLeaderboard(commodity, controller.signal)
      .then((data) => setBoards((b) => ({ ...b, [commodity]: { status: 'ready', data } })))
      .catch((error) => !isAbortError(error) && setBoards((b) => ({ ...b, [commodity]: loadError(error) })));
    return () => controller.abort();
  }, [commodity, boardNonce]);

  // While the backend is still training (503), ask again every 10 s until the leaderboard is ready
  const boardTraining = boards[commodity]?.status === 'error' && (boards[commodity] as { code?: number | null }).code === 503;
  useEffect(() => {
    if (!boardTraining) return;
    const id = window.setTimeout(() => setBoardNonce((n) => n + 1), TRAINING_RETRY_MS);
    return () => window.clearTimeout(id);
  }, [boardTraining]);

  const refreshActive = useCallback((name: string, signal?: AbortSignal) => {
    fetchActive(name, signal)
      .then((data) => setActives((a) => ({ ...a, [name]: data.items.find((i) => i.commodity === name) ?? null })))
      .catch(() => {
        // The chip simply stays empty if this fails; it never blocks the studio
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refreshActive(commodity, controller.signal);
    return () => controller.abort();
  }, [commodity, refreshActive]);

  // ---- samples ----
  const runCompare = useCallback(async (req: PreviewRequest) => {
    const m = latest.current.models;
    if (m.status !== 'ready') return;
    const others = m.data.models.filter((x) => x.available && x.id !== req.model);
    // Keep the old lines on screen while refreshing, but never another produce's lines
    setCompare((c) => ({ commodity: req.commodity, lines: c.commodity === req.commodity ? c.lines : [], loading: true }));
    const result = await compareRunner.current.run((signal) =>
      Promise.allSettled(others.map((x) => previewForecast({ ...req, model: x.id }, signal))),
    );
    if (!result) return;
    if (!result.ok) {
      setCompare({ commodity: req.commodity, lines: [], loading: false });
      return;
    }
    const lines: CompareSeries[] = [];
    result.value.forEach((r, i) => {
      if (r.status === 'fulfilled') lines.push({ id: others[i].id, name: others[i].name, color: COMPARE_COLORS[i % COMPARE_COLORS.length], points: r.value.forecast });
    });
    setCompare({ commodity: req.commodity, lines, loading: false });
  }, []);

  const runPreview = useCallback(
    async (req: PreviewRequest) => {
      window.clearTimeout(timer.current);
      setApply({ status: 'idle' });
      setSample((s) => ({
        ...s,
        loading: true,
        pending: { model: req.model, startedAt: Date.now() },
        error: null,
        discarded: false,
        // a different produce must never show the previous one's line under the loader
        ...(s.data && s.data.commodity !== req.commodity ? { data: null, applied: false, history: [] } : {}),
      }));
      if (latest.current.compareOn) void runCompare(req);
      const result = await runner.current.run((signal) => previewForecast(req, signal));
      if (!result) return; // superseded by a newer request
      if (result.ok) {
        setSample({ data: result.value, loading: false, pending: null, error: null, applied: false, discarded: false, history: result.value.history });
      } else {
        setSample((s) => ({ ...s, loading: false, pending: null, error: previewError(result.error) }));
      }
    },
    [runCompare],
  );

  const request = useMemo<PreviewRequest | null>(() => (modelId ? { commodity, model: modelId, ...params } : null), [commodity, modelId, params]);
  const requestRef = useRef(request);
  requestRef.current = request;

  // Any knob, model or produce change asks for a fresh sample ~350ms after the last change
  useEffect(() => {
    if (!request) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void runPreview(request), DEBOUNCE_MS);
    return () => window.clearTimeout(timer.current);
  }, [request, runPreview]);

  useEffect(
    () => () => {
      runner.current.cancel();
      compareRunner.current.cancel();
    },
    [],
  );

  const generate = useCallback(() => {
    if (requestRef.current) void runPreview(requestRef.current);
  }, [runPreview]);

  // Same for the sample: while the backend trains, retry every 10 s instead of leaving an error on screen
  const sampleTraining = sample.error?.code === 503;
  useEffect(() => {
    if (!sampleTraining) return;
    const id = window.setTimeout(generate, TRAINING_RETRY_MS);
    return () => window.clearTimeout(id);
  }, [sampleTraining, generate]);

  const discard = useCallback(() => {
    window.clearTimeout(timer.current);
    runner.current.cancel();
    compareRunner.current.cancel();
    setApply({ status: 'idle' });
    setCompare({ commodity: '', lines: [], loading: false });
    setSample((s) => ({ ...EMPTY_SAMPLE, discarded: true, history: s.data?.commodity === commodity ? s.history : [] }));
  }, [commodity]);

  const toggleCompare = useCallback((on: boolean) => {
    setCompareOn(on);
    if (!on) {
      compareRunner.current.cancel();
      setCompare({ commodity: '', lines: [], loading: false });
    } else if (requestRef.current && latest.current.sample.data) {
      void runCompare(requestRef.current);
    }
  }, [runCompare]);

  const showToast = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  const dismissToast = useCallback(() => setToast(null), []);

  const applySample = useCallback(async () => {
    const { sample: current, apply: state } = latest.current;
    const data = current.data;
    if (!data || current.loading || current.applied || state.status === 'applying') return;
    setApply({ status: 'applying' });
    try {
      const result = await applyForecast(data.preview_id);
      setSample((s) => (s.data?.preview_id === data.preview_id ? { ...s, applied: true } : s));
      setApply({ status: 'applied' });
      setActives((a) => ({
        ...a,
        [data.commodity]: {
          forecast_id: result.forecast_id,
          commodity: data.commodity,
          unit: data.unit,
          model: data.model,
          model_name: data.model_name,
          applied_at: result.applied_at,
          params: data.params,
          forecast: data.forecast,
          summary: data.summary,
        },
      }));
      showToast(`Applied · ordering now plans with ${data.model_name}`);
      refreshActive(data.commodity);
    } catch (error) {
      const code = errorStatus(error);
      const message =
        code === 404
          ? 'This sample expired on the server. Generate a fresh one, then apply it.'
          : code === 409
            ? 'A newer forecast was applied since this sample was made. Generate a fresh sample to replace it.'
            : code === null
              ? 'Couldn’t reach the server to apply it. Check the connection and try again.'
              : `Couldn’t apply this sample (${code}). Try again in a moment.`;
      setApply({ status: 'error', message });
    }
  }, [refreshActive, showToast]);

  const updateParams = useCallback((patch: Partial<PreviewParams>) => setParams((p) => ({ ...p, ...patch })), []);
  const resetParams = useCallback(() => setParams(DEFAULT_PARAMS), []);
  const selectModel = useCallback((id: string) => setModelId(id), []);

  const shown = sample.data && sample.data.commodity === commodity ? sample.data : null;
  // Knobs moved since the sample on screen was made (a new one is on its way)
  const stale = !!shown && (shown.model !== modelId || !sameParams(shown.params, params));
  const compareLines = compareOn && shown && compare.commodity === commodity ? compare.lines : NO_LINES;

  return {
    models,
    board: boards[commodity] ?? ({ status: 'loading' } as Load<Leaderboard>),
    active: actives[commodity] ?? null,
    modelId,
    params,
    sample,
    shown,
    stale,
    compareOn,
    compareLines,
    compareLoading: compareOn && compare.loading,
    apply,
    toast,
    retryModels,
    selectModel,
    updateParams,
    resetParams,
    generate,
    discard,
    applySample,
    toggleCompare,
    dismissToast,
  };
}

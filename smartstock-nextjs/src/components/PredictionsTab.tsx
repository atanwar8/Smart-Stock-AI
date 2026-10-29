'use client';

// Forecast Studio (the "Predictions" section): pick a produce and a model, play with the knobs, look at a
// sample prediction, then apply it so ordering plans with it. State lives in studio/useStudio; this file
// lays the pieces out and owns the keyboard shortcuts (Enter apply, Esc discard, G generate).
// Contract: docs/handoff/SPEC.md §5. Default export with no props; the shell lazy-loads it.

import { useEffect, useMemo, useRef } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useCommodity } from '@/contexts/CommodityContext';
import { STUDIO_MOCK } from '@/lib/studio';
import AnswerPanel from './studio/AnswerPanel';
import ChartCard from './studio/ChartCard';
import type { ChartData } from './studio/chartGeometry';
import { relativeTime, unitSuffix, weeks } from './studio/format';
import Knobs from './studio/Knobs';
import Leaderboard from './studio/Leaderboard';
import { ModelGlyph } from './studio/ModelGlyph';
import ModelPicker from './studio/ModelPicker';
import { Button, Chip, Eyebrow, Panel } from './studio/primitives';
import ProduceSwitcher from './studio/ProduceSwitcher';
import SuggestionBar from './studio/SuggestionBar';
import Toast from './studio/Toast';
import { useStudio } from './studio/useStudio';

const NO_LINES: ChartData['compare'] = [];

// Shortcuts never fire while typing, and Enter is left alone on anything that already handles it
function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
const handlesEnter = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (['BUTTON', 'A', 'SUMMARY'].includes(el.tagName) || el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'switch');
};

export default function PredictionsTab() {
  const { commodities, selectedCommodity, setSelectedCommodity, priceUnit } = useCommodity();
  const studio = useStudio(selectedCommodity);
  const { models, board, active, modelId, params, sample, shown, stale, compareLines, apply } = studio;

  const modelList = models.status === 'ready' ? models.data.models : null;
  const boardData = board.status === 'ready' ? board.data : null;
  const available = useMemo(() => new Set((modelList ?? []).filter((m) => m.available).map((m) => m.id)), [modelList]);
  const nameOf = (id: string | null | undefined) => (id ? (modelList?.find((m) => m.id === id)?.name ?? id) : null);

  const unit = shown ? unitSuffix(shown.unit) : boardData ? unitSuffix(boardData.unit) : priceUnit(selectedCommodity);

  const chartData = useMemo<ChartData | null>(() => {
    const activeLine = active && !(shown && sample.applied) ? active.forecast : null;
    if (shown) return { history: shown.history, backtest: shown.backtest, forecast: shown.forecast, active: activeLine, compare: compareLines };
    if (sample.discarded && sample.history.length) return { history: sample.history, backtest: [], forecast: [], active: active?.forecast ?? null, compare: NO_LINES };
    return null;
  }, [shown, sample.applied, sample.discarded, sample.history, active, compareLines]);

  // Loader caption: how many weeks the model will read (capped by what the store holds, once known)
  const storeWeeks = shown && shown.params.history_years === null ? shown.train_window.weeks : undefined;
  const loaderWeeks = params.history_years === null ? (shown?.train_window.weeks ?? 104) : Math.min(params.history_years * 52, storeWeeks ?? Infinity);

  // ---- keyboard shortcuts ----
  const keys = useRef(studio);
  keys.current = studio;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const s = keys.current;
      if (e.key === 'Enter' && !handlesEnter(e.target) && s.shown && !s.sample.applied && !s.stale && !s.sample.loading) {
        e.preventDefault();
        void s.applySample();
      } else if (e.key === 'Escape' && (s.shown || s.sample.loading) && !s.sample.applied) {
        e.preventDefault();
        s.discard();
      } else if ((e.key === 'g' || e.key === 'G') && !e.shiftKey) {
        e.preventDefault();
        s.generate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const modelName = nameOf(sample.loading ? sample.pending?.model : (shown?.model ?? modelId));
  const summary = shown
    ? `Sample prediction for ${selectedCommodity} from ${shown.model_name}. ${shown.summary}`
    : `Recent ${selectedCommodity} prices${active ? ` with the applied ${active.model_name} forecast` : ''}.`;

  return (
    <div className="pb-6">
      <header className="mb-6 flex flex-col gap-5 lg:mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <Eyebrow>Plan › Predictions</Eyebrow>
            <h1 className="mt-2 font-display text-[40px] leading-[1.02] tracking-[-0.02em] text-ink sm:text-[48px]">Forecast Studio</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              {active ? (
                <>
                  Ordering for <b className="font-semibold text-ink">{selectedCommodity}</b> plans with <b className="font-semibold text-ink">{active.model_name}</b>, applied{' '}
                  {relativeTime(active.applied_at)}. Try another model, play with the knobs, and apply the sample you trust.
                </>
              ) : (
                <>
                  No forecast is applied for <b className="font-semibold text-ink">{selectedCommodity}</b> yet. Try a model, play with the knobs, and apply the sample you
                  trust.
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STUDIO_MOCK && <Chip tone="warn">Mock data</Chip>}
            <div
              key={active?.forecast_id ?? 'none'}
              role="status"
              aria-label={active ? `Active forecast: ${active.model_name}, ${weeks(active.params.horizon_weeks)}, applied ${relativeTime(active.applied_at)}` : 'No active forecast'}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-2.5 pr-3.5 shadow-card"
            >
              <span aria-hidden className={active ? 'h-2 w-2 rounded-full bg-accent shadow-[0_0_0_3px_rgb(47_107_79/0.18)]' : 'h-2 w-2 rounded-full bg-line-2'} />
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Active forecast</span>
              {active ? (
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <ModelGlyph id={active.model} size={14} className="text-forecast" />
                  {active.model_name}
                  <span className="font-medium text-muted">
                    · {active.params.horizon_weeks}w · {relativeTime(active.applied_at)}
                  </span>
                </span>
              ) : (
                <span className="text-[13px] font-medium text-muted">none yet</span>
              )}
            </div>
          </div>
        </div>
        <ProduceSwitcher commodities={commodities} selected={selectedCommodity} onSelect={setSelectedCommodity} />
      </header>

      {models.status === 'error' ? (
        <Panel className="p-6 sm:p-8" role="alert">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-warn/10 text-warn">
            <AlertCircle aria-hidden className="h-5 w-5" />
          </span>
          <h2 className="mt-4 font-display text-[26px] leading-tight text-ink">The studio can&apos;t load its models</h2>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted">
            {models.message} Once the forecasting API answers <code className="rounded bg-well px-1 font-mono text-[12.5px]">/api/forecast/models</code>, everything here comes
            alive.
          </p>
          <Button className="mt-5" onClick={studio.retryModels}>
            <RefreshCw aria-hidden className="h-4 w-4" />
            Try again
          </Button>
        </Panel>
      ) : (
        // Phones: one column in reading order (chart, apply bar, answer, knobs, models, leaderboard).
        // Desktop: the two wrappers become real flex columns; `contents` lets `order` interleave them on phones.
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
            <ChartCard
              className="order-1"
              commodity={selectedCommodity}
              commodities={commodities}
              modelName={modelName}
              data={chartData}
              revealKey={shown?.preview_id ?? 'none'}
              applied={!!shown && sample.applied}
              isSample={!!shown}
              unit={unit}
              confidence={shown?.params.confidence ?? params.confidence}
              loading={sample.loading}
              startedAt={sample.pending?.startedAt ?? null}
              loaderWeeks={loaderWeeks}
              error={sample.error?.message ?? null}
              compare={compareLines}
              showApplied={!!chartData?.active}
              summary={summary}
              onRetry={studio.generate}
            />
            <div className="sticky bottom-3 z-20 order-2 -mt-1 lg:-mt-2">
              <SuggestionBar
                preview={shown}
                loading={sample.loading}
                stale={stale}
                applied={sample.applied}
                discarded={sample.discarded}
                apply={apply}
                pendingModel={nameOf(sample.pending?.model)}
                onApply={studio.applySample}
                onDiscard={studio.discard}
                onGenerate={studio.generate}
              />
            </div>
            <Knobs
              className="order-4"
              params={params}
              onChange={studio.updateParams}
              onReset={studio.resetParams}
              onGenerate={studio.generate}
              generating={sample.loading}
              lastDate={shown?.history[shown.history.length - 1]?.date ?? boardData?.test_end}
              trainedWeeks={shown && shown.params.history_years === params.history_years ? shown.train_window.weeks : undefined}
              compareOn={studio.compareOn}
              compareLoading={studio.compareLoading}
              onCompare={studio.toggleCompare}
            />
            <Panel className="order-5 p-5 sm:p-6" aria-labelledby="studio-models-title">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <Eyebrow>Models</Eyebrow>
                  <h2 id="studio-models-title" className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-ink">
                    Who makes the call
                  </h2>
                </div>
                {boardData && <span className="text-[12.5px] text-muted">Skill measured on {selectedCommodity.toLowerCase()} hold-out weeks</span>}
              </div>
              <ModelPicker models={modelList} board={boardData} selected={modelId} onSelect={studio.selectModel} />
            </Panel>
          </div>

          <div className="contents lg:flex lg:flex-col lg:gap-5">
            <AnswerPanel className="order-3" preview={shown} applied={sample.applied} loading={sample.loading || (!shown && !sample.error && !sample.discarded)} />
            <Leaderboard className="order-6" board={board} selected={modelId} available={available} onSelect={studio.selectModel} />
          </div>
        </div>
      )}

      <Toast toast={studio.toast} onDone={studio.dismissToast} />
    </div>
  );
}

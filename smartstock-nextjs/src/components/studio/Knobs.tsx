'use client';

// The four knobs a chef can play with. Each slider reports instantly (readouts move live); the studio hook
// debounces the actual sample request.

import { memo, useCallback } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { CONFIDENCE, DEFAULT_PARAMS, HISTORY_SNAPS, HORIZON, PACE, type PreviewParams } from '@/lib/studio';
import { MINUS, addWeeks, shortDate, weeks } from './format';
import { Button, Eyebrow, Kbd, Panel, Switch } from './primitives';
import { Slider, type SliderTick } from './Slider';

interface KnobsProps {
  params: PreviewParams;
  onChange: (patch: Partial<PreviewParams>) => void;
  onReset: () => void;
  onGenerate: () => void;
  generating: boolean;
  /** Last real report week, for "to Sep 26" */
  lastDate?: string;
  /** Weeks the model actually learned from in the sample on screen */
  trainedWeeks?: number;
  compareOn: boolean;
  compareLoading: boolean;
  onCompare: (on: boolean) => void;
  className?: string;
}

const HORIZON_TICKS: SliderTick[] = HORIZON.ticks.map((w) => ({ value: w, label: `${w}w` }));
const CONFIDENCE_TICKS: SliderTick[] = [50, 65, 80, 95].map((v) => ({ value: v, label: `${v}%` }));
const HISTORY_LABELS = HISTORY_SNAPS.map((y) => (y === null ? 'All' : `${y}y`));
const HISTORY_TICKS: SliderTick[] = HISTORY_LABELS.map((label, i) => ({ value: i, label }));
const PACE_TICKS: SliderTick[] = [-40, -20, 20, 40, 60].map((v) => ({ value: v, label: v > 0 ? `+${v}` : `${MINUS}${Math.abs(v)}` }));

const horizonText = (v: number) => weeks(v);
const confidenceText = (v: number) => `${v} percent range`;
const historyText = (i: number) => (HISTORY_SNAPS[i] === null ? 'All stored history' : `Last ${HISTORY_SNAPS[i]} years`);
const paceText = (v: number) => (v === 0 ? 'As forecast' : `${v > 0 ? 'Plus' : 'Minus'} ${Math.abs(v)} percent`);

export function paceReadout(v: number) {
  if (v === 0) return '0% · as forecast';
  return v > 0 ? `+${v}% · prices run hotter` : `${MINUS}${Math.abs(v)}% · prices run cooler`;
}

function Knobs({ params, onChange, onReset, onGenerate, generating, lastDate, trainedWeeks, compareOn, compareLoading, onCompare, className }: KnobsProps) {
  const setHorizon = useCallback((v: number) => onChange({ horizon_weeks: v }), [onChange]);
  const setConfidence = useCallback((v: number) => onChange({ confidence: v / 100 }), [onChange]);
  const setHistory = useCallback((i: number) => onChange({ history_years: HISTORY_SNAPS[i] }), [onChange]);
  const setPace = useCallback((v: number) => onChange({ pace_pct: v }), [onChange]);

  const historyIndex = Math.max(0, HISTORY_SNAPS.indexOf(params.history_years));
  const confidence = Math.round(params.confidence * 100);
  const requestedWeeks = params.history_years === null ? Infinity : params.history_years * 52;
  const isDefault =
    params.horizon_weeks === DEFAULT_PARAMS.horizon_weeks &&
    confidence === Math.round(DEFAULT_PARAMS.confidence * 100) &&
    params.history_years === DEFAULT_PARAMS.history_years &&
    params.pace_pct === DEFAULT_PARAMS.pace_pct;

  return (
    <Panel className={className} aria-labelledby="studio-knobs-title">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div>
          <Eyebrow>Knobs</Eyebrow>
          <h2 id="studio-knobs-title" className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-ink">
            Shape the sample
          </h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset} disabled={isDefault} aria-label="Reset knobs to defaults">
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          Reset
        </Button>
      </div>

      <div className="grid gap-x-8 gap-y-6 px-5 pb-2 pt-5 sm:grid-cols-2 sm:px-6">
        <Slider
          label="Horizon"
          value={params.horizon_weeks}
          min={HORIZON.min}
          max={HORIZON.max}
          pageStep={4}
          onChange={setHorizon}
          valueText={horizonText}
          readout={lastDate ? `${weeks(params.horizon_weeks)} · to ${shortDate(addWeeks(lastDate, params.horizon_weeks))}` : weeks(params.horizon_weeks)}
          ticks={HORIZON_TICKS}
        />
        <Slider
          label="Confidence"
          value={confidence}
          min={CONFIDENCE.min}
          max={CONFIDENCE.max}
          step={CONFIDENCE.step}
          pageStep={15}
          onChange={setConfidence}
          valueText={confidenceText}
          readout={`${confidence}% range · ${confidence >= 85 ? 'wider, safer' : confidence <= 60 ? 'tight, bolder' : 'balanced'}`}
          ticks={CONFIDENCE_TICKS}
        />
        <Slider
          label="History used"
          value={historyIndex}
          min={0}
          max={HISTORY_SNAPS.length - 1}
          pageStep={2}
          onChange={setHistory}
          valueText={historyText}
          readout={params.history_years === null ? 'Everything stored' : `Last ${params.history_years} year${params.history_years === 1 ? '' : 's'}`}
          ticks={HISTORY_TICKS}
          tone="accent"
          hint={trainedWeeks && trainedWeeks + 2 < requestedWeeks ? `Only ${trainedWeeks} weeks are stored, so the model sees all of them.` : undefined}
        />
        <Slider
          label="Pace"
          value={params.pace_pct}
          min={PACE.min}
          max={PACE.max}
          pageStep={10}
          onChange={setPace}
          valueText={paceText}
          readout={paceReadout(params.pace_pct)}
          ticks={PACE_TICKS}
          origin={0}
          originLabel="as forecast"
          tone="pace"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-6">
        <Switch checked={compareOn} onChange={onCompare} label={compareLoading ? 'Comparing models…' : 'Compare every model'} />
        <Button variant="secondary" onClick={onGenerate} disabled={generating} aria-keyshortcuts="G">
          <Sparkles aria-hidden className="h-4 w-4 text-forecast" />
          {generating ? 'Generating…' : 'Generate sample'}
          <Kbd>G</Kbd>
        </Button>
      </div>
    </Panel>
  );
}

export default memo(Knobs);

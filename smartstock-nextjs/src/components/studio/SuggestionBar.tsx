'use client';

// The floating suggestion under the chart, like accepting a suggestion in Wispr Flow:
// "Sample from TimesFM · 8 weeks · 80% range"  [Discard  Esc]  [Apply prediction  ↵]

import { memo } from 'react';
import { AlertCircle, Check, Loader2, Sparkles } from 'lucide-react';
import type { Preview } from '@/lib/studio';
import type { ApplyState } from './useStudio';
import { cx, weeks } from './format';
import { paceReadout } from './Knobs';
import { Button, Kbd } from './primitives';
import s from './studio.module.css';

interface SuggestionBarProps {
  preview: Preview | null;
  loading: boolean;
  stale: boolean;
  applied: boolean;
  discarded: boolean;
  apply: ApplyState;
  pendingModel: string | null;
  onApply: () => void;
  onDiscard: () => void;
  onGenerate: () => void;
  className?: string;
}

function describeSample(p: Preview) {
  const parts = [weeks(p.params.horizon_weeks), `${Math.round(p.params.confidence * 100)}% range`];
  if (p.params.pace_pct !== 0) parts.push(paceReadout(p.params.pace_pct).split(' · ')[0] + ' pace');
  return parts.join(' · ');
}

function SuggestionBar({ preview, loading, stale, applied, discarded, apply, pendingModel, onApply, onDiscard, onGenerate, className }: SuggestionBarProps) {
  const shell = cx(
    'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[22px] border border-line bg-surface/92 px-4 py-3 shadow-pop backdrop-blur-md sm:flex-nowrap sm:rounded-full sm:py-2.5 sm:pl-5 sm:pr-2.5',
    className,
  );

  if (discarded && !loading) {
    return (
      <div className={shell} role="region" aria-label="Sample">
        <p className="min-w-0 flex-1 text-[13.5px] text-muted">Sample discarded. Your applied forecast is unchanged.</p>
        <Button variant="secondary" size="sm" onClick={onGenerate}>
          <Sparkles aria-hidden className="h-3.5 w-3.5 text-forecast" />
          New sample
        </Button>
      </div>
    );
  }

  if (!preview) {
    if (!loading && !pendingModel) return null;
    return (
      <div className={shell} role="region" aria-label="Sample">
        <p className="flex min-w-0 flex-1 items-center gap-2.5 text-[13.5px] text-muted">
          <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin text-forecast motion-reduce:animate-none" />
          Preparing a sample{pendingModel ? ` from ${pendingModel}` : ''}…
        </p>
        <Button variant="primary" disabled>
          Apply prediction
        </Button>
      </div>
    );
  }

  const busy = loading || stale;
  const applying = apply.status === 'applying';

  if (applied && !busy) {
    return (
      <div key="applied" className={cx(shell, s.pop, 'border-accent/30')} role="region" aria-label="Sample">
        <p className="flex min-w-0 flex-1 items-center gap-2.5 text-[13.5px] text-ink">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
            <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
          <span className="min-w-0">
            <b className="font-semibold">Applied</b> · ordering now plans with {preview.model_name}
            <span className="text-muted"> · {describeSample(preview)}</span>
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className={shell} role="region" aria-label="Sample suggestion">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2.5 text-[13.5px] text-ink">
          {busy ? (
            <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin text-forecast motion-reduce:animate-none" />
          ) : (
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-forecast-soft text-forecast">
              <Sparkles aria-hidden className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="min-w-0">
            {busy ? (
              <span className="text-muted">Updating the sample…</span>
            ) : (
              <>
                <b className="font-semibold">Sample from {preview.model_name}</b>
                <span className="text-muted"> · {describeSample(preview)}</span>
                {preview.mode === 'stored' && <span className="text-muted"> · stored, computed offline</span>}
              </>
            )}
          </span>
        </p>
        {apply.status === 'error' && (
          <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-bad">
            <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
            {apply.message}
          </p>
        )}
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Button variant="ghost" onClick={onDiscard} disabled={applying} aria-keyshortcuts="Escape" className="flex-1 sm:flex-none">
          Discard
          <Kbd>Esc</Kbd>
        </Button>
        <Button variant="primary" onClick={onApply} disabled={busy || applying} aria-keyshortcuts="Enter" className="flex-[2] sm:flex-none">
          {applying ? <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Check aria-hidden className="h-4 w-4" strokeWidth={2.6} />}
          {applying ? 'Applying…' : 'Apply prediction'}
          <Kbd className="border-accent-ink/30">↵</Kbd>
        </Button>
      </div>
    </div>
  );
}

export default memo(SuggestionBar);

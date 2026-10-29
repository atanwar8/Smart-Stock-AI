'use client';

// Presagio-style answer: one big number, the API's one-sentence summary, and the backtest metrics
// translated into plain kitchen language.

import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarRange, ShieldCheck, Target, Trophy } from 'lucide-react';
import type { Preview } from '@/lib/studio';
import { MINUS, cx, finite, money, monthYear, pct, shortDate, unitSuffix } from './format';
import { Chip, Eyebrow, Panel, Skeleton } from './primitives';
import s from './studio.module.css';

interface AnswerPanelProps {
  preview: Preview | null;
  applied: boolean;
  loading: boolean;
  className?: string;
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts from the previous value to the new one (~420ms, ease-out); instant under reduced motion */
function useTicker(target: number) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || prefersReducedMotion()) {
      from.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const k = Math.min(1, (now - t0) / 420);
      const eased = 1 - (1 - k) ** 3;
      const v = start + (target - start) * eased;
      from.current = v;
      setValue(v);
      if (k < 1) frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function Metric({ icon: Icon, children, title }: { icon: typeof Target; children: ReactNode; title?: string }) {
  return (
    <li className="flex items-start gap-3" title={title}>
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-well text-muted">
        <Icon aria-hidden className="h-3.5 w-3.5" />
      </span>
      <span className="text-[13.5px] leading-snug text-ink">{children}</span>
    </li>
  );
}

function AnswerPanel({ preview, applied, loading, className }: AnswerPanelProps) {
  // Measured from the last 4 real weeks' average, the same basis as the backend's summary sentence
  // (ml/service.py _summary): one promo-spike week would otherwise turn a flat outlook into "-21%".
  const recentWeeks = (preview?.history ?? []).slice(-4).map((h) => h.price).filter(finite);
  const last = recentWeeks.length
    ? recentWeeks.reduce((sum, price) => sum + price, 0) / recentWeeks.length
    : preview?.backtest[preview.backtest.length - 1]?.actual;
  const end = preview?.forecast[preview.forecast.length - 1];
  const change = finite(last) && end && last > 0 ? ((end.yhat - last) / last) * 100 : 0;
  const shown = useTicker(Math.round(change));
  const rounded = Math.round(shown);
  const unit = unitSuffix(preview?.unit);

  if (!preview || !end) {
    return (
      <Panel className={cx('p-5 sm:p-6', className)} aria-busy={loading}>
        <Eyebrow>The answer</Eyebrow>
        {loading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-16 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <div className="space-y-3 pt-4">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-5/6" />
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[14px] leading-relaxed text-muted">Generate a sample and the answer shows up here: where prices are heading, how sure the model is, and how it did on weeks it never saw.</p>
        )}
      </Panel>
    );
  }

  const { metrics, train_window: tw } = preview;
  const conf = Math.round(preview.params.confidence * 100);
  const trend = Math.abs(change) < 2 ? { label: 'Holding steady', tone: 'neutral' as const } : change < 0 ? { label: 'Prices easing', tone: 'good' as const } : { label: 'Prices climbing', tone: 'warn' as const };
  const skill = finite(metrics.skill) ? Math.round(metrics.skill * 100) : null;

  return (
    <Panel className={cx('relative overflow-hidden p-5 sm:p-6', className)} aria-busy={loading} aria-label="The answer">
      <p className="sr-only" aria-live="polite">
        {applied ? 'Applied. ' : 'Sample. '}
        {preview.summary}
      </p>
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>{applied ? 'The answer · applied' : 'The answer · sample'}</Eyebrow>
        <Chip tone={trend.tone} dot>
          {trend.label}
        </Chip>
      </div>

      <div key={preview.preview_id} className={cx('mt-4', s.caption)}>
        <p className={cx('font-display text-[64px] leading-[0.9] tracking-[-0.02em] tabular', change < -2 ? 'text-good' : change > 2 ? 'text-warn' : 'text-ink')}>
          {rounded > 0 ? '+' : rounded < 0 ? MINUS : ''}
          {Math.abs(rounded)}%
        </p>
        <p className="mt-2 font-display text-[22px] leading-tight text-ink">
          {money(end.yhat)}
          <span className="text-[15px] text-muted">{unit}</span> by {shortDate(end.date)}
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted tabular">
          {conf}% range {money(end.lo)} – {money(end.hi)}
        </p>
        <p className="mt-4 text-[14.5px] leading-relaxed text-ink">{preview.summary}</p>
      </div>

      <ul className="mt-5 space-y-3 border-t border-line pt-5">
        {finite(metrics.mae) && (
          <Metric icon={Target} title={finite(metrics.mape) ? `Mean absolute error; about ${metrics.mape.toFixed(1)}% of the price` : 'Mean absolute error on the hold-out weeks'}>
            Typical error <b className="font-semibold tabular">{money(metrics.mae)}</b>
            {finite(metrics.mape) && <span className="text-muted"> · about {metrics.mape.toFixed(1)}% of the price</span>}
          </Metric>
        )}
        {skill !== null && (
          <Metric icon={Trophy} title="Skill vs seasonal-naive: repeating the price from the same point last season, on the same hold-out weeks">
            {skill > 0 ? (
              <>
                Beats the copy-last-season rule by <b className="font-semibold tabular">{skill}%</b>
              </>
            ) : skill === 0 ? (
              <>Ties the copy-last-season rule</>
            ) : (
              <>
                Trails the copy-last-season rule by <b className="font-semibold tabular">{Math.abs(skill)}%</b>
              </>
            )}
          </Metric>
        )}
        {finite(metrics.coverage) && (
          <Metric icon={ShieldCheck} title={`Share of hold-out prices that landed inside the model's ${conf}% range`}>
            Range caught <b className="font-semibold tabular">{pct(metrics.coverage)}</b> of real prices
            <span className="text-muted"> · aiming for {conf}%</span>
          </Metric>
        )}
        {tw && (
          <Metric icon={CalendarRange}>
            Learned from <b className="font-semibold tabular">{tw.weeks} weeks</b>
            <span className="text-muted">
              {' '}
              · {monthYear(tw.start)} → {monthYear(tw.end)}
            </span>
          </Metric>
        )}
      </ul>

      <p className="mt-5 flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
        <span>{preview.model_name}</span>
        <span aria-hidden>·</span>
        <span>{preview.mode === 'live' ? 'Live' : preview.mode}</span>
        {finite(preview.elapsed_ms) && preview.elapsed_ms > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="tabular">{(preview.elapsed_ms / 1000).toFixed(1)} s</span>
          </>
        )}
      </p>
    </Panel>
  );
}

export default memo(AnswerPanel);

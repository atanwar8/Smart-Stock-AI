'use client';

// A custom, keyboard-accessible slider (WAI-ARIA slider pattern): the thumb is the focusable role="slider",
// arrows step, Page Up/Down jump, Home/End go to the ends. Pointer drags snap to `step`.
// It only reports values; debouncing the network call is the caller's job.

import { memo, useCallback, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from './format';

export interface SliderTick {
  value: number;
  label: string;
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  pageStep?: number;
  onChange: (value: number) => void;
  /** Spoken value, e.g. "8 weeks" */
  valueText: (value: number) => string;
  /** Visible live readout next to the label */
  readout: ReactNode;
  hint?: ReactNode;
  ticks?: SliderTick[];
  /** The fill grows from here (e.g. 0 for the pace slider); defaults to min */
  origin?: number;
  /** Label for a center mark at `origin`, clickable to reset */
  originLabel?: string;
  /** Fill color: one tone, or a different tone each side of `origin` */
  tone?: 'forecast' | 'accent' | 'pace';
}

const FILL = { forecast: 'bg-forecast', accent: 'bg-accent' } as const;

export const Slider = memo(function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  pageStep,
  onChange,
  valueText,
  readout,
  hint,
  ticks,
  origin,
  originLabel,
  tone = 'forecast',
}: SliderProps) {
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const span = max - min;
  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);
  const snap = useCallback((v: number) => clamp(Math.round((v - min) / step) * step + min), [clamp, min, step]);
  const pos = (v: number) => ((v - min) / span) * 100;

  const commit = (next: number) => {
    if (next !== value) onChange(next);
  };

  const fromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return value;
    return snap(min + ((clientX - rect.left) / rect.width) * span);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    thumbRef.current?.focus({ preventScroll: true });
    commit(fromPointer(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) commit(fromPointer(e.clientX));
  };
  const endDrag = () => setDragging(false);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const big = pageStep ?? Math.max(step, Math.round(span / 10 / step) * step);
    const next: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + big,
      PageDown: value - big,
      Home: min,
      End: max,
    };
    if (!(e.key in next)) return;
    e.preventDefault();
    commit(snap(next[e.key]));
  };

  const from = origin ?? min;
  const lo = Math.min(from, value);
  const hi = Math.max(from, value);
  const fill = tone === 'pace' ? (value > from ? 'bg-warn' : 'bg-info') : FILL[tone];
  const ring = tone === 'pace' ? (value > from ? 'border-warn' : value < from ? 'border-info' : 'border-line-2') : tone === 'accent' ? 'border-accent' : 'border-forecast';

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span id={`${id}-label`} className="text-[13px] font-semibold text-ink">
          {label}
        </span>
        <span className="truncate text-right text-[12.5px] font-medium text-muted tabular" aria-hidden>
          {readout}
        </span>
      </div>

      <div
        ref={trackRef}
        className="relative mt-2.5 h-7 cursor-pointer touch-pan-y select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-well" />
        <div
          className={cx('absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-[left,width] duration-150 ease-spring', fill, dragging && 'duration-0')}
          style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }}
        />
        {origin !== undefined && (
          <div aria-hidden className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-ink/40" style={{ left: `${pos(origin)}%` }} />
        )}
        <div
          ref={thumbRef}
          role="slider"
          tabIndex={0}
          aria-labelledby={`${id}-label`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={valueText(value)}
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
          className={cx(
            'absolute top-1/2 h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface shadow-[0_2px_8px_-2px_rgb(14_26_23/0.35)] outline-none transition-[left,transform,box-shadow] duration-150 ease-spring',
            'focus-visible:shadow-[0_0_0_5px_var(--color-forecast-soft),0_2px_8px_-2px_rgb(14_26_23/0.35)]',
            ring,
            dragging ? 'scale-110 duration-0' : 'hover:scale-105',
          )}
          style={{ left: `${pos(value)}%` }}
        />
      </div>

      {(ticks || originLabel) && (
        <div className="relative mt-1 h-4" aria-hidden>
          {ticks?.map((t) => (
            <button
              key={t.value}
              type="button"
              tabIndex={-1}
              onClick={() => commit(snap(t.value))}
              className={cx(
                'absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] leading-4 transition-colors hover:text-ink',
                t.value === value ? 'font-semibold text-ink' : 'text-faint',
                t.value === min && 'translate-x-0',
                t.value === max && '-translate-x-full',
              )}
              style={{ left: `${pos(t.value)}%` }}
            >
              {t.label}
            </button>
          ))}
          {originLabel && origin !== undefined && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => commit(origin)}
              className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] leading-4 text-faint hover:text-ink"
              style={{ left: `${pos(origin)}%` }}
            >
              {originLabel}
            </button>
          )}
        </div>
      )}

      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] leading-snug text-muted">
          {hint}
        </p>
      )}
    </div>
  );
});

'use client';

// "Predicting" state: a kitchen-timer dial whose tick ring turns slowly, an iris comet sweeping round it,
// produce symbols orbiting outside, the elapsed seconds in the middle and step captions that cycle below.
// Its 100ms clock lives here so ticking never re-renders the rest of the studio.
// Reduced motion: nothing turns; the centre breathes gently instead.

import { memo, useEffect, useMemo, useState } from 'react';
import { ProduceIcon } from '@/components/produce/ProduceIcon';
import { cx } from './format';
import s from './studio.module.css';

interface PredictingLoaderProps {
  modelName: string;
  commodity: string;
  /** All commodities, for the orbiting symbols */
  commodities: string[];
  weeks: number;
  confidence: number;
  /** When the request started; until one is in flight the loader counts from when it appeared */
  startedAt?: number | null;
  compact?: boolean;
}

const SIZE = 196;
const C = SIZE / 2;
const TICKS = Array.from({ length: 60 }, (_, i) => i);

function PredictingLoader({ modelName, commodity, commodities, weeks, confidence, startedAt, compact }: PredictingLoaderProps) {
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.max(0, (now - (startedAt ?? mountedAt)) / 1000);

  const steps = useMemo(
    () => [
      `Reading ${weeks} weeks of prices…`,
      `Fitting ${modelName}…`,
      'Replaying the hold-out weeks…',
      `Calibrating the ${Math.round(confidence * 100)}% range…`,
      'Drawing the cone…',
    ],
    [weeks, modelName, confidence],
  );
  // Walk through the steps once, then keep cycling the middle ones while a slow model is still busy
  const tick = Math.floor(elapsed / 0.95);
  const step = tick < steps.length ? tick : 1 + ((tick - steps.length) % (steps.length - 1));

  const orbiters = useMemo(() => {
    const others = commodities.filter((c) => c !== commodity);
    return [commodity, ...others].slice(0, 6);
  }, [commodities, commodity]);

  return (
    <div role="status" aria-live="polite" className={cx('flex flex-col items-center text-center', compact ? 'gap-3' : 'gap-5')}>
      <div className={cx('relative', compact && 'scale-[0.82]')} style={{ width: SIZE, height: SIZE }} aria-hidden>
        {/* dial: hairline face + 60 ticks turning slowly */}
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0">
          <circle cx={C} cy={C} r={62} fill="var(--color-surface)" stroke="var(--color-line)" />
          <g className={s.spinSlow} style={{ transformOrigin: `${C}px ${C}px` }}>
            {TICKS.map((i) => {
              const major = i % 5 === 0;
              const a = (i / 60) * Math.PI * 2;
              const r1 = major ? 50 : 53;
              return (
                <line
                  key={i}
                  x1={C + Math.cos(a) * r1}
                  y1={C + Math.sin(a) * r1}
                  x2={C + Math.cos(a) * 57}
                  y2={C + Math.sin(a) * 57}
                  stroke={major ? 'var(--color-ink)' : 'var(--color-line-2)'}
                  strokeOpacity={major ? 0.5 : 1}
                  strokeWidth={major ? 1.6 : 1}
                  strokeLinecap="round"
                />
              );
            })}
          </g>
          {/* comet sweep */}
          <g className={s.spinComet} style={{ transformOrigin: `${C}px ${C}px` }}>
            <circle
              cx={C}
              cy={C}
              r={62}
              fill="none"
              stroke="var(--color-forecast)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 62 * 0.18} ${2 * Math.PI * 62}`}
              transform={`rotate(-90 ${C} ${C})`}
            />
            <circle cx={C} cy={C - 62} r={4} fill="var(--color-forecast)" transform={`rotate(${0.18 * 360} ${C} ${C})`} />
          </g>
        </svg>

        {/* produce orbiting outside the dial, counter-rotated so they stay upright */}
        <div className={cx('absolute inset-0', s.orbit)}>
          {orbiters.map((c, i) => {
            const a = (i / orbiters.length) * Math.PI * 2 - Math.PI / 2;
            const r = 84;
            return (
              <span
                key={c}
                className={cx('absolute', s.counterOrbit)}
                style={{ left: C + Math.cos(a) * r - 15, top: C + Math.sin(a) * r - 15, width: 30, height: 30 }}
              >
                <ProduceIcon commodity={c} size={30} bubble animated={false} className="rounded-full bg-surface shadow-[0_4px_12px_-6px_rgb(14_26_23/0.4)]" />
              </span>
            );
          })}
        </div>

        {/* centre: elapsed seconds */}
        <div className={cx('absolute inset-0 grid place-items-center', s.breathe)}>
          <div>
            <p className="font-display text-[34px] leading-none text-ink tabular">
              {elapsed.toFixed(1)}
              <span className="ml-0.5 text-[16px] text-muted">s</span>
            </p>
            <p className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-forecast">Predicting</p>
          </div>
        </div>
      </div>

      <p key={step} aria-hidden className={cx('min-h-[20px] text-[13.5px] font-medium text-ink', s.caption)}>
        {steps[step]}
      </p>
      <span className="sr-only">
        {modelName} is preparing a sample prediction for {commodity}.
      </span>
    </div>
  );
}

export default memo(PredictingLoader);

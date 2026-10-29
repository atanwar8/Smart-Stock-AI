'use client';

// The hero card: produce + model header, the lazily-loaded sample chart (or the predicting loader / an
// error / the discarded state), and a legend that reads like a key on a market chalkboard.

import { memo } from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { ProduceIcon } from '@/components/produce/ProduceIcon';
import type { ChartData, CompareSeries } from './chartGeometry';
import { cx } from './format';
import { Button, Chip, Eyebrow, Panel, Skeleton } from './primitives';
import PredictingLoader from './PredictingLoader';

// Code-split: the SVG chart only loads once there is something to draw
const ForecastChart = dynamic(() => import('./ForecastChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[250px] w-full sm:h-[330px]" />,
});

interface ChartCardProps {
  commodity: string;
  commodities: string[];
  modelName: string | null;
  data: ChartData | null;
  revealKey: string;
  applied: boolean;
  isSample: boolean;
  unit: string;
  confidence: number;
  loading: boolean;
  startedAt: number | null;
  loaderWeeks: number;
  error: string | null;
  compare: CompareSeries[];
  showApplied: boolean;
  summary: string;
  onRetry: () => void;
  className?: string;
}

function LegendSwatch({ kind, color }: { kind: 'line' | 'dash' | 'dot' | 'area' | 'dots'; color: string }) {
  return (
    <svg aria-hidden width="18" height="10" viewBox="0 0 18 10" className="shrink-0">
      {kind === 'line' && <path d="M1 5h16" stroke={color} strokeWidth="2.25" strokeLinecap="round" />}
      {kind === 'dash' && <path d="M1 5h16" stroke={color} strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />}
      {kind === 'dots' && <path d="M1 5h16" stroke={color} strokeWidth="1.6" strokeDasharray="1.5 3.5" strokeLinecap="round" opacity="0.6" />}
      {kind === 'area' && <rect x="1" y="1" width="16" height="8" rx="3" fill={color} opacity="0.28" />}
      {kind === 'dot' && (
        <>
          <path d="M4 2.5h6" stroke="var(--color-forecast)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="6" r="3" fill={color} />
        </>
      )}
    </svg>
  );
}

function ChartCard({
  commodity,
  commodities,
  modelName,
  data,
  revealKey,
  applied,
  isSample,
  unit,
  confidence,
  loading,
  startedAt,
  loaderWeeks,
  error,
  compare,
  showApplied,
  summary,
  onRetry,
  className,
}: ChartCardProps) {
  const conf = Math.round(confidence * 100);
  const loader = (compact: boolean) => (
    <PredictingLoader
      key={commodity}
      modelName={modelName ?? 'the model'}
      commodity={commodity}
      commodities={commodities}
      weeks={loaderWeeks}
      confidence={confidence}
      startedAt={startedAt}
      compact={compact}
    />
  );

  return (
    <Panel className={cx('relative', className)} aria-labelledby="studio-chart-title">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <ProduceIcon commodity={commodity} size={40} bubble animated />
          <div className="min-w-0">
            <Eyebrow>Sample prediction</Eyebrow>
            <h2 id="studio-chart-title" className="mt-0.5 truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
              {commodity}
              {modelName && <span className="font-medium text-muted"> · {modelName}</span>}
            </h2>
          </div>
        </div>
        {data && data.forecast.length > 0 && (
          applied ? (
            <Chip tone="accent" dot>
              Applied
            </Chip>
          ) : isSample ? (
            <Chip tone="forecast" className="border border-dashed border-forecast/50">
              Sample · not applied
            </Chip>
          ) : null
        )}
      </div>

      <div className="relative px-3 pb-2 pt-4 sm:px-5">
        {data ? (
          <>
            <div className={cx('transition-[opacity,filter] duration-300', loading && 'opacity-35 blur-[1.5px]')}>
              <ForecastChart data={data} state={applied ? 'applied' : 'sample'} revealKey={revealKey} unit={unit} confidence={confidence} label={summary} />
            </div>
            {loading && <div className="absolute inset-0 grid place-items-center">{loader(true)}</div>}
          </>
        ) : error ? (
          <div role="alert" className="grid min-h-[250px] place-items-center px-4 text-center sm:min-h-[330px]">
            <div className="max-w-sm">
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-bad/10 text-bad">
                <AlertCircle aria-hidden className="h-5 w-5" />
              </span>
              <p className="mt-3 text-[14.5px] font-semibold text-ink">No sample this time</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{error}</p>
              <Button className="mt-4" size="sm" onClick={onRetry}>
                <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid min-h-[250px] place-items-center py-4 sm:min-h-[330px]">{loader(false)}</div>
        )}
        {data && error && !loading && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 px-2 text-[12.5px] text-bad">
            <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>

      {data && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-5 py-3.5 text-[12px] text-muted sm:px-6" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <LegendSwatch kind="line" color="var(--color-accent)" />
            Actual price
          </li>
          {data.backtest.length > 0 && (
            <li className="flex items-center gap-1.5">
              <LegendSwatch kind="dot" color="var(--color-accent)" />
              Hold-out: model vs real
            </li>
          )}
          {data.forecast.length > 0 && (
            <>
              <li className="flex items-center gap-1.5">
                <LegendSwatch kind={applied ? 'line' : 'dash'} color="var(--color-forecast)" />
                Forecast
              </li>
              <li className="flex items-center gap-1.5">
                <LegendSwatch kind="area" color="var(--color-forecast)" />
                {conf}% range
              </li>
            </>
          )}
          {showApplied && (
            <li className="flex items-center gap-1.5">
              <LegendSwatch kind="dots" color="var(--color-ink)" />
              Applied now
            </li>
          )}
          {compare.map((c) => (
            <li key={c.id} className="flex items-center gap-1.5">
              <LegendSwatch kind="line" color={c.color} />
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default memo(ChartCard);

'use client';

import { memo } from 'react';
import { CloudFog } from 'lucide-react';
import { AreaLine, type RangePoint, type SeriesPoint } from '../charts';
import ProduceIcon, { produceMeta, tintAlpha } from '../produce/ProduceIcon';
import { Button, Card, Delta, Empty, Micro, Skeleton, Ticker, money } from '../ui';

interface MarketPulseProps {
  commodity: string;
  unit: string;
  actual: SeriesPoint[];
  forecast: RangePoint[];
  /** "in 7 days" / "in 4 weeks" */
  horizonLabel: string;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  mae?: number;
  skillPct?: number;
  volatility?: { score: number; level: string; swing: number };
}

const pct = (from: number, to: number) => (from ? ((to - from) / from) * 100 : 0);

// The page's one night card: the selected produce's recent USDA prices as luminous bars in its own tint,
// the forecast in iris. It changes mood with every symbol you pick.
function MarketPulseBase({ commodity, unit, actual, forecast, horizonLabel, loading, error, onRetry, mae, skillPct, volatility }: MarketPulseProps) {
  const meta = produceMeta(commodity);
  const current = actual.at(-1)?.value;
  const prior = actual.at(-2)?.value;
  const end = forecast.at(-1)?.value;
  const change = current !== undefined && end !== undefined ? pct(current, end) : undefined;

  return (
    <Card tone="night" label={`${commodity} market pulse`} className="lg:col-span-7">
      {/* A soft glow of the produce's tint behind the numbers */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-32 h-80 w-80 rounded-full blur-3xl transition-[background-color] duration-700"
        style={{ backgroundColor: tintAlpha(meta.tint, 0.28) }}
      />
      <div className="relative px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-white/[0.07] ring-1 ring-white/10">
              <ProduceIcon commodity={commodity} size={34} animated />
            </span>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-white">Market pulse</div>
              <Micro className="text-night-ink/55">USDA retail{unit ? `, ${unit.replace(/^\//, 'per ').trim()}` : ''}</Micro>
            </div>
          </div>
          {change !== undefined && (
            <div className="text-right">
              <Micro className="text-night-ink/55">{horizonLabel}</Micro>
              <div className="tabular mt-1 font-display text-[26px] leading-none text-[#c4c5ff]">{money(end!)}</div>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
          {current !== undefined ? (
            <div className="font-display text-[64px] leading-[0.9] tracking-[-0.02em] text-white sm:text-[76px]">
              <Ticker value={current} format={(n) => money(n)} />
              <span className="ml-1 font-sans text-[15px] font-medium tracking-normal text-night-ink/55">{unit}</span>
            </div>
          ) : (
            <Skeleton night className="h-[68px] w-48" />
          )}
          <div className="flex flex-wrap items-center gap-2 pb-2 text-[12.5px] text-night-ink/65">
            {current !== undefined && prior !== undefined && (
              <span className="inline-flex items-center gap-1.5">
                <Delta night value={pct(prior, current)} upIsGood={false} /> vs prior report
              </span>
            )}
            {change !== undefined && (
              <span className="inline-flex items-center gap-1.5">
                <Delta night value={change} upIsGood={false} /> {horizonLabel}
              </span>
            )}
          </div>
        </div>

        {/* While the next produce loads, the previous chart dims instead of jumping */}
        <div className={['mt-4 transition-opacity duration-300', loading && actual.length ? 'opacity-50' : ''].join(' ')} aria-busy={loading}>
          {error && !actual.length ? (
            <Empty night icon={CloudFog} title="Prices didn't load" body={error} action={<Button variant="night" size="sm" onClick={onRetry}>Try again</Button>} />
          ) : actual.length ? (
            <AreaLine
              night
              actualStyle="bars"
              actualColor={meta.tint}
              actual={actual}
              forecast={forecast}
              height={210}
              marker="Latest report"
              animKey={commodity}
              format={(n) => `$${n.toFixed(2)}`}
              label={`${commodity}: last ${actual.length} USDA weekly prices as bars, ending at ${money(current ?? 0)}${unit}; forecast ${horizonLabel} ${end !== undefined ? money(end) : 'not available'}.`}
            />
          ) : (
            <Skeleton night className={loading ? 'h-[210px]' : 'h-[210px] opacity-40'} />
          )}
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-white/[0.08] pt-4">
          <Fact label="Typical error" value={mae !== undefined ? `±${money(mae)}` : '—'} note="per forecast" />
          <Fact label="Volatility" value={volatility ? `${volatility.score.toFixed(1)}` : '—'} note={volatility ? `${volatility.level}, ±${volatility.swing}%` : 'last 14 days'} />
          <Fact label="Skill" value={skillPct !== undefined ? `${skillPct >= 0 ? '+' : ''}${skillPct.toFixed(0)}%` : '—'} note="vs last week's price" />
        </dl>
      </div>
    </Card>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0">
      <dt className="micro text-night-ink/50">{label}</dt>
      <dd className="tabular mt-1 truncate font-display text-[24px] leading-none text-white">{value}</dd>
      <dd className="mt-1 truncate text-[11.5px] text-night-ink/55">{note}</dd>
    </div>
  );
}

export const MarketPulse = memo(MarketPulseBase);
export default MarketPulse;

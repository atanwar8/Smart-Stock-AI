'use client';

import { memo } from 'react';
import { Sparkles } from 'lucide-react';
import { goToTab } from '@/lib/tabs';
import { verb } from '@/lib/words';
import { Cone, type RangePoint, type SeriesPoint } from '../charts';
import { produceMeta } from '../produce/ProduceIcon';
import { Button, Card, Micro, Pill, Skeleton, money, type Tone } from '../ui';

interface ConeCardProps {
  commodity: string;
  unit: string;
  actual: SeriesPoint[];
  forecast: RangePoint[];
  /** Where the forecast came from: an applied Studio forecast or the built-in daily model */
  source: { kind: 'studio'; model: string; appliedAt?: string } | { kind: 'model' };
  loading: boolean;
}

const longDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Presagio-style answer: one big serif number for "where it lands", the cone for how sure we are
function ConeCardBase({ commodity, unit, actual, forecast, source, loading }: ConeCardProps) {
  const label = produceMeta(commodity).label;
  const last = actual.at(-1);
  const end = forecast.at(-1);
  const change = last && end ? ((end.value - last.value) / last.value) * 100 : undefined;
  const ranged = forecast.filter((p) => p.lo !== undefined && p.hi !== undefined);
  const lo = ranged.length ? Math.min(...ranged.map((p) => p.lo!)) : undefined;
  const hi = ranged.length ? Math.max(...ranged.map((p) => p.hi!)) : undefined;

  const status: { tone: Tone; text: string } | undefined =
    change === undefined
      ? undefined
      : Math.abs(change) < 2
      ? { tone: 'good', text: 'Holding steady' }
      : change > 0
      ? { tone: 'warn', text: `Rising about ${Math.round(change)}%` }
      : { tone: 'good', text: `Easing about ${Math.round(-change)}%` };

  return (
    <Card label={`${label} forecast cone`} className="flex flex-col lg:col-span-5">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Where {label.toLowerCase()} {verb(label, 'go', 'goes')} next</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {source.kind === 'studio' ? <>Applied in the studio with {source.model}</> : <>Built-in daily model with its likely range</>}
          </p>
        </div>
        {status && <Pill tone={status.tone}>{status.text}</Pill>}
      </div>

      <div className="flex items-end gap-3 px-5 pt-4 sm:px-6">
        {end ? (
          <>
            <span className="tabular font-display text-[52px] leading-[0.9] text-forecast">{money(end.value)}</span>
            <span className="pb-1 text-[13px] leading-snug text-muted">
              {unit && <span className="block">{unit.replace(/^\//, 'per ').trim()}</span>}
              by <b className="font-semibold text-ink">{longDay(end.date)}</b>
            </span>
          </>
        ) : (
          <Skeleton className="h-[48px] w-40" />
        )}
      </div>

      <div className="flex-1 px-3 pt-3 sm:px-4">
        {actual.length ? (
          <Cone
            actual={actual.slice(-8)}
            forecast={forecast}
            height={200}
            animKey={commodity}
            label={`${label} forecast: ${end ? money(end.value) : 'unknown'} by ${end ? longDay(end.date) : 'the end of the period'}${lo !== undefined && hi !== undefined ? `, likely between ${money(lo)} and ${money(hi)}` : ''}.`}
          />
        ) : (
          <Skeleton className={loading ? 'h-[200px]' : 'h-[200px] opacity-50'} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-6">
        <div className="flex items-center gap-4 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-accent" /> Actual
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0 w-4 border-t-2 border-dashed border-forecast" /> Forecast
          </span>
          {lo !== undefined && hi !== undefined && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm bg-forecast-soft" />
              <Micro className="text-faint">
                {money(lo)} to {money(hi)}
              </Micro>
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" icon={Sparkles} onClick={() => goToTab('predictions')}>
          Open studio
        </Button>
      </div>
    </Card>
  );
}

export const ConeCard = memo(ConeCardBase);
export default ConeCard;

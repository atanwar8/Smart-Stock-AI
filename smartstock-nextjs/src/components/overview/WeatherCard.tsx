'use client';

import { memo } from 'react';
import { Droplets } from 'lucide-react';
import type { WeatherImpact, Weather } from '@/lib/types';
import { weatherIcon, weekday } from '@/lib/weather';
import ZipCodeInput from '../ZipCodeInput';
import { Card, CardHeader, Pill, Skeleton, WeatherCredit, cx } from '../ui';

function WeatherCardBase({ weather, loading, zip, impact }: { weather?: Weather; loading: boolean; zip: string; impact?: WeatherImpact }) {
  const w = weather;
  const sample = w?.city?.startsWith('City-');
  const TodayIcon = weatherIcon(w?.current_condition);
  const hasImpact = impact && impact.explanation;

  return (
    <Card label="Growing weather" className="flex flex-col lg:col-span-4">
      <CardHeader
        title="Growing weather"
        subtitle={sample ? `Sample data for ${zip}: live weather didn't load.` : `${w?.city ?? 'Your area'}${w?.state ? `, ${w.state}` : ''}, next five days.`}
        action={<ZipCodeInput compact />}
      />
      <div className={cx('flex-1 px-5 pb-5 transition-opacity sm:px-6', loading && w && 'opacity-50')} aria-busy={loading}>
        {!w ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#fdf3dc] text-[#a06a12]">
                <TodayIcon className="h-7 w-7" strokeWidth={1.7} />
              </span>
              <div>
                <div className="tabular font-display text-[44px] leading-none text-ink">{Math.round(w.current_temp)}°</div>
                <div className="mt-1 flex items-center gap-3 text-[12.5px] text-muted">
                  <span>{w.current_condition}</span>
                  <span className="flex items-center gap-1">
                    <Droplets className="h-3.5 w-3.5" />
                    {Math.round(w.current_humidity)}%
                  </span>
                </div>
              </div>
            </div>
            <ol className="mt-5 grid grid-cols-5 gap-1.5">
              {w.forecast.slice(0, 5).map((d) => {
                const Icon = weatherIcon(d.condition);
                return (
                  <li key={d.date} className="rounded-[14px] bg-surface-2 py-2.5 text-center" title={d.condition}>
                    <div className="micro text-faint">{weekday(d.date)}</div>
                    <Icon className="mx-auto my-1.5 h-4 w-4 text-muted" strokeWidth={1.8} />
                    <div className="tabular text-[13px] font-semibold">{Math.round(d.temp_high)}°</div>
                    <div className="tabular text-[11.5px] text-faint">{Math.round(d.temp_low)}°</div>
                  </li>
                );
              })}
            </ol>
            {hasImpact && (
              <div className="mt-4 text-[12.5px] leading-relaxed text-muted">
                <Pill tone={impact.impact === 'negative' ? 'warn' : impact.impact === 'positive' ? 'good' : 'neutral'}>
                  {impact.impact === 'negative' ? 'Tough growing week' : impact.impact === 'positive' ? 'Good growing week' : 'Neutral week'}
                </Pill>
                <p className="mt-2">{impact.explanation}</p>
              </div>
            )}
            {!sample && <WeatherCredit />}
          </>
        )}
      </div>
    </Card>
  );
}

export const WeatherCard = memo(WeatherCardBase);
export default WeatherCard;

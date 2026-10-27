'use client';

import { useState } from 'react';
import { CalendarRange, TrendingDown, TrendingUp } from 'lucide-react';
import { useCommodity } from '../contexts/CommodityContext';
import { qs, useApi } from '@/lib/api';
import type { ExtendedForecast, Seasonal, Volatility } from '@/lib/types';
import Chart, { CHART } from './Chart';
import { Card, CardHeader, ErrorNote, PageHeader, Pill, Segmented, Select, Skeleton, money, cx, type Tone } from './ui';

type Period = '7-Day' | '14-Day' | '30-Day';

const PERIOD_WORDS: Record<Period, string> = { '7-Day': 'week', '14-Day': 'two weeks', '30-Day': 'month' };

const volatilityTone = (score: number): Tone => (score < 3 ? 'good' : score < 7 ? 'warn' : 'bad');

export default function PredictionsTab() {
  const { commodities, selectedCommodity, setSelectedCommodity, selectedZipCode, priceUnit } = useCommodity();
  const unit = priceUnit(selectedCommodity);
  const [period, setPeriod] = useState<Period>('30-Day');

  const forecast = useApi<ExtendedForecast>(`/extended-forecast?${qs({ commodity: selectedCommodity, period, zip_code: selectedZipCode })}`);
  const seasonal = useApi<Seasonal>(`/seasonal-patterns?${qs({ commodity: selectedCommodity })}`);
  const volatility = useApi<Volatility>(`/market-volatility?${qs({ commodity: selectedCommodity })}`);

  const f = forecast.data;
  const start = f?.base_forecast[0];
  const end = f?.base_forecast.at(-1);
  const best = f ? Math.min(...f.pessimistic) : undefined;
  const worst = f ? Math.max(...f.optimistic) : undefined;
  const change = start && end ? ((end - start) / start) * 100 : undefined;

  const s = seasonal.data;
  const v = volatility.data;

  return (
    <>
      <PageHeader
        crumb={<>Plan <span className="mx-1.5">›</span> Predictions</>}
        title={`${selectedCommodity} outlook`}
        summary={
          f && start !== undefined && end !== undefined ? (
            <>
              Over the next {PERIOD_WORDS[period]} the base forecast goes from <b>{money(start)}</b> to <b>{money(end)}{unit}</b>, likely staying between{' '}
              <b>{money(best!)}</b> and <b>{money(worst!)}</b>.
            </>
          ) : (
            'Extended forecasts, seasonal patterns and how jumpy prices are right now.'
          )
        }
        actions={
          <Select aria-label="Commodity" value={selectedCommodity} onChange={(e) => setSelectedCommodity(e.target.value)} className="min-w-44">
            {commodities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Price outlook"
            subtitle="Base forecast with the range between a good and a bad market."
            action={
              <Segmented
                label="Forecast period"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: '7-Day', label: '7 days' },
                  { value: '14-Day', label: '14 days' },
                  { value: '30-Day', label: '30 days' },
                ]}
              />
            }
          />
          <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[1fr_260px]">
            <div className="h-[300px]">
              {forecast.error ? (
                <ErrorNote>Couldn&apos;t load the forecast: {forecast.error}</ErrorNote>
              ) : f ? (
                <Chart
                  data={[
                    { x: f.dates, y: f.optimistic, type: 'scatter', mode: 'lines', name: 'High case', line: { color: CHART.brass, width: 1.5, dash: 'dot', shape: 'spline' }, hovertemplate: '$%{y:.2f}<extra>High case</extra>' },
                    {
                      x: f.dates,
                      y: f.pessimistic,
                      type: 'scatter',
                      mode: 'lines',
                      name: 'Low case',
                      fill: 'tonexty',
                      fillcolor: CHART.brassSoft,
                      line: { color: CHART.brass, width: 1.5, dash: 'dot', shape: 'spline' },
                      hovertemplate: '$%{y:.2f}<extra>Low case</extra>',
                    },
                    {
                      x: f.dates,
                      y: f.base_forecast,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: 'Base forecast',
                      line: { color: CHART.primary, width: 3, shape: 'spline' },
                      marker: { size: 7, color: CHART.primary, line: { color: '#fbfcfa', width: 2 } },
                      hovertemplate: '$%{y:.2f}<extra>Base</extra>',
                    },
                  ]}
                  layout={{ yaxis: { tickprefix: '$', tickformat: '.2f' } }}
                />
              ) : (
                <Skeleton className="h-full" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 self-start lg:grid-cols-1">
              <Stat label="Base at end of period" value={end !== undefined ? money(end) : '—'} note={change !== undefined ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}% from today` : undefined} />
              <Stat label="Low case" value={best !== undefined ? money(best) : '—'} note="if supply is strong" icon={TrendingDown} />
              <Stat label="High case" value={worst !== undefined ? money(worst) : '—'} note="if supply tightens" icon={TrendingUp} />
            </div>
          </div>
        </Card>

        {/* Seasonality */}
        <Card className="lg:col-span-2">
          <CardHeader title="Seasonal pattern" subtitle={`Average price${unit} by month, one row per year of USDA data.`} />
          <div className="px-5 pb-5">
            <div className="h-[230px]">
              {s ? (
                <Chart
                  data={[
                    {
                      z: s.price_matrix,
                      x: s.months,
                      y: s.years.map(String),
                      type: 'heatmap',
                      colorscale: [
                        [0, '#f3f5f1'],
                        [0.5, '#9cc7b7'],
                        [1, '#0b6b5f'],
                      ],
                      xgap: 3,
                      ygap: 3,
                      colorbar: { thickness: 8, outlinewidth: 0, tickprefix: '$', tickformat: '.2f', tickfont: { size: 11, color: CHART.muted } },
                      hovertemplate: `%{x} %{y}: $%{z:.2f}${unit}<extra></extra>`,
                    },
                  ]}
                  layout={{ xaxis: { showgrid: false }, yaxis: { showgrid: false, type: 'category' }, hovermode: 'closest', margin: { l: 48, r: 8 } }}
                />
              ) : (
                <Skeleton className="h-full" />
              )}
            </div>
            {s && (
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <Stat label="Usually most expensive" value={s.peak_month} icon={CalendarRange} />
                <Stat label="Usually cheapest" value={s.low_month} icon={CalendarRange} />
                <Stat label="Typical yearly swing" value={`${money(s.price_range)}${unit}`} />
              </div>
            )}
          </div>
        </Card>

        {/* Volatility */}
        <Card>
          <CardHeader title="Volatility" subtitle={v ? `How much prices moved over the last ${v.period.replace('-day', ' days')}.` : 'How much prices are moving right now.'} />
          <div className="px-5 pb-5">
            {!v ? (
              <Skeleton className="h-48" />
            ) : (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="tabular text-[44px] font-semibold leading-none tracking-[-0.03em]">{v.volatility_score.toFixed(1)}</span>
                  <span className="text-[16px] font-semibold text-faint">/ 10</span>
                  <span className="ml-auto">
                    <Pill tone={volatilityTone(v.volatility_score)}>{v.volatility_level.charAt(0).toUpperCase() + v.volatility_level.slice(1)}</Pill>
                  </span>
                </div>
                {/* Scale: calm 0–3, moderate 3–7, volatile 7–10 */}
                <div className="relative mt-5">
                  <div className="flex h-2.5 gap-1 overflow-hidden rounded-full">
                    <span className="h-full w-[30%] bg-[#2f9a5a]/70" />
                    <span className="h-full w-[40%] bg-[#d99a1e]/70" />
                    <span className="h-full w-[30%] bg-[#dd5a43]/70" />
                  </div>
                  <span
                    className="absolute -top-1 h-[18px] w-[18px] -translate-x-1/2 rounded-full border-[3px] border-surface bg-ink shadow"
                    style={{ left: `${Math.min(100, Math.max(0, v.volatility_score * 10))}%` }}
                    aria-hidden="true"
                  />
                  <div className="mt-2 flex justify-between text-[11.5px] text-faint">
                    <span>Calm</span>
                    <span>Moderate</span>
                    <span>Volatile</span>
                  </div>
                </div>
                <div className="mt-5 rounded-tile bg-surface-2 p-3.5">
                  <div className="text-[12.5px] text-muted">Expected swing</div>
                  <div className="tabular text-[20px] font-semibold">±{v.expected_price_swing}%</div>
                </div>
                <p className="mt-4 text-[13px] leading-relaxed text-muted">{v.volatility_analysis}</p>
              </>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, note, icon: Icon }: { label: string; value: string; note?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className={cx('rounded-tile border border-line px-4 py-3')}>
      <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="tabular mt-0.5 text-[20px] font-semibold tracking-[-0.01em]">{value}</div>
      {note && <div className="text-[12px] text-faint">{note}</div>}
    </div>
  );
}

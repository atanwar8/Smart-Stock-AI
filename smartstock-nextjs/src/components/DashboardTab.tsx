'use client';

import { useEffect, useMemo } from 'react';
import { ArrowUpRight, CheckCircle2, Cloud, CloudFog, CloudRain, Droplets, PackageOpen, Snowflake, Sun } from 'lucide-react';
import { useCommodity } from '../contexts/CommodityContext';
import { qs, useApi } from '@/lib/api';
import { goToTab } from '@/lib/tabs';
import type { InventoryRow, Kpis, SevenDay, TrendChart, Volatility, Weather } from '@/lib/types';
import Chart, { CHART } from './Chart';
import ZipCodeInput from './ZipCodeInput';
import { Button, Card, CardHeader, Delta, Empty, Meter, PageHeader, Pill, ProduceTile, Select, Skeleton, money, statusLabel, statusTone, cx } from './ui';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

const pct = (from: number, to: number) => (from ? ((to - from) / from) * 100 : 0);
const num = (s: string) => parseFloat(s) || 0;
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const weatherIcon = (condition = '') => {
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('storm') || c.includes('drizzle')) return CloudRain;
  if (c.includes('snow')) return Snowflake;
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return CloudFog;
  if (c.includes('cloud')) return Cloud;
  return Sun;
};

export default function DashboardTab() {
  const { commodities, selectedCommodity, setSelectedCommodity, selectedState, selectedZipCode, priceUnit } = useCommodity();
  const unit = priceUnit(selectedCommodity);
  const place = qs({ state: selectedState, zip_code: selectedZipCode });

  const trends = useApi<TrendChart>(`/30-day-trends?${qs({ commodity: selectedCommodity })}&${place}`);
  const week = useApi<SevenDay>(`/7-day-prediction?${qs({ commodity: selectedCommodity })}&${place}`);
  const volatility = useApi<Volatility>(`/market-volatility?${qs({ commodity: selectedCommodity })}`);
  const kpis = useApi<Kpis>('/dashboard/kpi');
  const inventory = useApi<{ inventory: InventoryRow[] }>('/inventory/list');
  const weather = useApi<Weather>(`/weather?${place}&days=7`);

  // Opening a commodity trains its model on first use, so refresh accuracy once its trend arrives
  const { reload: reloadKpis } = kpis;
  useEffect(() => {
    if (trends.data) reloadKpis();
  }, [trends.data, reloadKpis]);

  const series = useMemo(() => {
    const byName = (name: string) => trends.data?.data.find((t) => t.name === name);
    return { actual: byName('Actual Price'), forecast: byName('Forecast'), upper: byName('Upper Bound'), lower: byName('Lower Bound') };
  }, [trends.data]);

  const actualY = series.actual?.y ?? [];
  const current = actualY.at(-1);
  const lastWeek = actualY.at(-2);
  const lastDate = series.actual?.x.at(-1);
  const weekPrices = week.data?.predictions.map((p) => p.price) ?? [];
  const weekEnd = weekPrices.at(-1);
  // Compare the forecast with the latest real price, not with the model's own first day
  const weekChange = weekEnd !== undefined && current !== undefined ? pct(current, weekEnd) : undefined;

  const details = kpis.data?.forecast_accuracy.accuracy_details ?? {};
  const detail = details[selectedCommodity];

  const rows = inventory.data?.inventory ?? [];
  const needsOrder = rows.filter((r) => r.status_color === 'red' || r.status_color === 'yellow');

  const orderItem = (commodity: string) => {
    setSelectedCommodity(commodity);
    goToTab('ordering');
  };

  const chartData = useMemo(() => {
    const { actual, forecast, upper, lower } = series;
    if (!actual) return [];
    const join = (t?: { x: string[]; y: number[] }) => (t ? { x: [actual.x.at(-1), ...t.x], y: [actual.y.at(-1), ...t.y] } : { x: [], y: [] });
    return [
      { ...join(upper), type: 'scatter', mode: 'lines', line: { width: 0, shape: 'spline' }, hoverinfo: 'skip' },
      { ...join(lower), type: 'scatter', mode: 'lines', line: { width: 0, shape: 'spline' }, fill: 'tonexty', fillcolor: CHART.brassSoft, hoverinfo: 'skip' },
      {
        x: actual.x,
        y: actual.y,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Actual',
        line: { color: CHART.primary, width: 2.5 },
        marker: { size: 6, color: CHART.primary, line: { color: '#fbfcfa', width: 1.5 } },
        hovertemplate: `$%{y:.2f}${unit}<extra>Actual</extra>`,
      },
      {
        ...join(forecast),
        type: 'scatter',
        mode: 'lines',
        name: 'Forecast',
        line: { color: CHART.brass, width: 2.5, dash: 'dash', shape: 'spline' },
        hovertemplate: `$%{y:.2f}${unit}<extra>Forecast</extra>`,
      },
    ];
  }, [series, unit]);

  const w = weather.data;
  const sampleWeather = w?.city?.startsWith('City-');
  const TodayIcon = weatherIcon(w?.current_condition);

  return (
    <>
      <PageHeader
        crumb={
          <>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })} <span className="mx-1.5">›</span> Kitchen in {selectedZipCode}
          </>
        }
        title={greeting()}
        summary={
          <>
            {needsOrder.length > 0 ? (
              <>
                <b>
                  {needsOrder.length} item{needsOrder.length === 1 ? '' : 's'}
                </b>{' '}
                need ordering soon.{' '}
              </>
            ) : (
              <>Stock is healthy. </>
            )}
            {weekChange !== undefined && (
              <>
                {selectedCommodity} is forecast to <b>{Math.abs(weekChange) < 0.05 ? 'hold steady' : `${weekChange > 0 ? 'rise' : 'fall'} ${Math.abs(weekChange).toFixed(1)}%`}</b> over the next 7 days.
              </>
            )}
          </>
        }
        actions={
          <Button icon={ArrowUpRight} onClick={() => goToTab('predictions')}>
            Open predictions
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Price pulse: the signature view. History left of the marker, forecast to the right. */}
        <Card className="lg:col-span-2">
          <CardHeader
            title={`${selectedCommodity} price pulse`}
            subtitle={lastDate ? `USDA retail prices through ${shortDate(lastDate)}, then the model's forecast.` : 'USDA retail prices, then the model’s forecast.'}
            action={
              <Select aria-label="Commodity" value={selectedCommodity} onChange={(e) => setSelectedCommodity(e.target.value)}>
                {commodities.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            }
          />

          <div className="mx-5 grid grid-cols-2 overflow-hidden rounded-tile border border-line md:grid-cols-4">
            <KpiTile label="Latest price" loading={!trends.data && trends.loading}>
              <span className="tabular">{current !== undefined ? money(current) : '—'}</span>
              <small className="ml-0.5 text-[13px] font-semibold text-faint">{unit}</small>
              <Sub>{current !== undefined && lastWeek !== undefined && <Delta value={pct(lastWeek, current)} upIsGood={false} />} vs prior report</Sub>
            </KpiTile>
            <KpiTile label="In 7 days" loading={!week.data && week.loading}>
              <span className="tabular text-brass">{weekEnd !== undefined ? money(weekEnd) : '—'}</span>
              <Sub>{weekChange !== undefined && <Delta value={weekChange} upIsGood={false} />} vs latest</Sub>
            </KpiTile>
            <KpiTile label="Typical error" loading={!kpis.data && kpis.loading}>
              <span className="tabular">{detail ? `±${money(detail.mae)}` : '—'}</span>
              <Sub>{detail ? <><Delta value={detail.skill_pct} /> vs. last week&apos;s price</> : 'model is training'}</Sub>
            </KpiTile>
            <KpiTile label="Volatility" loading={!volatility.data && volatility.loading}>
              <span className="tabular">{volatility.data ? volatility.data.volatility_score.toFixed(1) : '—'}</span>
              <small className="ml-0.5 text-[13px] font-semibold text-faint">/10</small>
              <Sub>{volatility.data ? `${volatility.data.volatility_level}, ±${volatility.data.expected_price_swing}% swings` : 'last 14 days'}</Sub>
            </KpiTile>
          </div>

          <div className="h-[300px] px-3 pb-1 pt-3">
            {trends.error ? (
              <Empty icon={CloudFog} title="Couldn't load prices" body={trends.error} action={<Button onClick={trends.reload}>Try again</Button>} />
            ) : chartData.length ? (
              <Chart
                data={chartData}
                layout={{
                  yaxis: { tickprefix: '$', tickformat: '.2f' },
                  xaxis: { type: 'date', tickformat: '%b %-d' },
                  shapes: lastDate ? [{ type: 'line', x0: lastDate, x1: lastDate, yref: 'paper', y0: 0, y1: 1, line: { color: CHART.ink, width: 1, dash: 'dot' } }] : [],
                  annotations: lastDate
                    ? [{ x: lastDate, y: 1, yref: 'paper', yanchor: 'bottom', text: 'Latest report', showarrow: false, bgcolor: CHART.ink, font: { color: '#fff', size: 11 }, borderpad: 4 }]
                    : [],
                  margin: { t: 26 },
                }}
              />
            ) : (
              <Skeleton className="h-full" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 pb-5 text-[12.5px] text-muted">
            <LegendDot className="bg-primary" label="Actual price" />
            <LegendDot className="h-0.5 w-4 rounded-none border-t-2 border-dashed border-brass bg-transparent" label="Forecast" />
            <LegendDot className="h-2.5 w-4 rounded-sm bg-brass/20" label="Likely range" />
          </div>
        </Card>

        {/* Stock on hand */}
        <Card className="flex flex-col">
          <CardHeader
            title="Stock on hand"
            subtitle="How long each item lasts at today's usage."
            action={
              <Button variant="ghost" className="h-8 px-3" onClick={() => goToTab('ordering')}>
                Manage
              </Button>
            }
          />
          <div className="flex-1 px-3 pb-3">
            {inventory.loading && !inventory.data ? (
              <div className="space-y-2 px-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <Empty icon={PackageOpen} title="No stock logged yet" body="Log what's in the walk-in to see days of cover and order timing." action={<Button variant="primary" onClick={() => goToTab('ordering')}>Log stock</Button>} />
            ) : (
              <ul className="space-y-1">
                {rows.map((r) => {
                  const days = num(r.days_left);
                  const tone = statusTone(r.status_color);
                  return (
                    <li key={r.id} className="rounded-tile px-2 py-2.5 hover:bg-surface-2">
                      <div className="flex items-center gap-3">
                        <ProduceTile name={r.ingredient} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[14px] font-semibold">{r.ingredient}</span>
                            <Pill tone={tone}>{statusLabel(r.status)}</Pill>
                          </div>
                          <div className="mt-0.5 text-[12.5px] text-muted">
                            {r.current_stock} · uses {r.daily_usage.replace('/day', ' a day')}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-3 pl-12">
                        <Meter value={days / 14} tone={tone} label={`${r.ingredient} days of cover`} />
                        <span className="tabular w-16 shrink-0 text-right text-[12.5px] font-semibold">{days.toFixed(1)} days</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* Needs a look */}
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Needs a look
                {needsOrder.length > 0 && <span className="tabular rounded-full bg-[#dd5a43] px-2 py-0.5 text-[11px] font-bold text-white">{needsOrder.length}</span>}
              </span>
            }
            subtitle="Items that run out before a normal delivery cycle."
          />
          <div className="space-y-2 px-4 pb-4">
            {needsOrder.length === 0 ? (
              <Empty icon={CheckCircle2} title="Nothing needs you right now" body="Anything with under six days of cover will show up here." />
            ) : (
              <>
                {needsOrder.map((r) => (
                  <div key={r.id} className={cx('rounded-tile border p-3', r.status_color === 'red' ? 'border-bad/20 bg-bad/[0.05]' : 'border-[#d99a1e]/25 bg-[#d99a1e]/[0.07]')}>
                    <div className="flex items-start gap-3">
                      <ProduceTile name={r.ingredient} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold">{r.ingredient} runs out in {num(r.days_left).toFixed(1)} days</p>
                        <p className="text-[12.5px] text-muted">
                          {r.current_stock} left, using {r.daily_usage}
                        </p>
                      </div>
                      <Button variant="secondary" className="h-8 px-3 text-[12.5px]" onClick={() => orderItem(r.ingredient)}>
                        Order
                      </Button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </Card>

        {/* Model reliability */}
        <Card>
          <CardHeader title="Forecast skill" subtitle="How much smaller each model's error is than repeating last week's price." />
          <ul className="px-5 pb-4">
            {commodities.map((c) => {
              const skill = details[c]?.skill_pct;
              // 10 segments cover 0–30% better than the naive guess
              const filled = skill === undefined ? 0 : Math.round(Math.min(30, Math.max(0, skill)) / 3);
              const tone = skill === undefined ? '' : skill >= 10 ? 'bg-[#2f9a5a]' : skill > 0 ? 'bg-[#d99a1e]' : 'bg-[#dd5a43]';
              return (
                <li key={c}>
                  <button
                    onClick={() => setSelectedCommodity(c)}
                    className="grid w-full grid-cols-[1fr_auto_3.5rem] items-center gap-3 rounded-lg py-1.5 text-left hover:bg-surface-2"
                    title={skill === undefined ? `Select ${c} to train its model` : `Show ${c}`}
                  >
                    <span className={cx('truncate text-[13px]', c === selectedCommodity ? 'font-bold text-ink' : 'text-muted')}>{c}</span>
                    <span className="flex gap-[3px]" aria-hidden="true">
                      {Array.from({ length: 10 }, (_, i) => (
                        <span key={i} className={cx('h-3.5 w-2 rounded-[3px]', i < filled ? tone : 'bg-well')} />
                      ))}
                    </span>
                    <span className="tabular text-right text-[12.5px] font-semibold">{skill === undefined ? <span className="font-medium text-faint">Untrained</span> : `${skill >= 0 ? '+' : ''}${skill.toFixed(0)}%`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-[12px] text-muted">
            <LegendDot className="bg-[#2f9a5a]" label="10%+ better" />
            <LegendDot className="bg-[#d99a1e]" label="Slightly better" />
            <LegendDot className="bg-[#dd5a43]" label="No better" />
            <span className="ml-auto text-faint">Select a row to train it</span>
          </div>
        </Card>

        {/* Weather */}
        <Card>
          <CardHeader
            title="Growing weather"
            subtitle={sampleWeather ? `Sample data for ZIP ${selectedZipCode}. OpenWeather isn't returning live weather yet.` : `${w?.city ?? 'Your area'} (${selectedZipCode}), next five days.`}
            action={<ZipCodeInput compact />}
          />
          <div className={cx('px-5 pb-5 transition-opacity', weather.loading && w && 'opacity-50')} aria-busy={weather.loading}>
            {!w ? (
              <Skeleton className="h-40" />
            ) : (
              <>
                <div className="flex items-center gap-4">
                  <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-[#f3ead7] text-[#8a5a12]">
                    <TodayIcon className="h-7 w-7" />
                  </span>
                  <div>
                    <div className="tabular text-[30px] font-semibold leading-none tracking-tight">{Math.round(w.current_temp)}°F</div>
                    <div className="mt-1 flex items-center gap-3 text-[13px] text-muted">
                      <span>{w.current_condition}</span>
                      <span className="flex items-center gap-1">
                        <Droplets className="h-3.5 w-3.5" />
                        {Math.round(w.current_humidity)}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-5 gap-1.5">
                  {w.forecast.slice(0, 5).map((d) => {
                    const Icon = weatherIcon(d.condition);
                    return (
                      <div key={d.date} className="rounded-tile bg-surface-2 py-2 text-center">
                        <div className="text-[11.5px] font-semibold text-muted">{new Date(`${d.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}</div>
                        <Icon className="mx-auto my-1.5 h-4 w-4 text-muted" />
                        <div className="tabular text-[12.5px] font-semibold">{Math.round(d.temp_high)}°</div>
                        <div className="tabular text-[11.5px] text-faint">{Math.round(d.temp_low)}°</div>
                      </div>
                    );
                  })}
                </div>
                {week.data?.weather_impact && (
                  <p className="mt-4 text-[12.5px] text-muted">
                    <Pill tone={week.data.weather_impact.impact === 'negative' ? 'warn' : week.data.weather_impact.impact === 'positive' ? 'good' : 'neutral'}>
                      {week.data.weather_impact.impact === 'negative' ? 'Tough growing week' : week.data.weather_impact.impact === 'positive' ? 'Good growing week' : 'Neutral week'}
                    </Pill>{' '}
                    <span className="mt-1.5 block">{week.data.weather_impact.explanation}</span>
                  </p>
                )}
              </>
            )}
          </div>
        </Card>

        {/* Inventory table */}
        <Card className="lg:col-span-3">
          <CardHeader
            title="Inventory"
            subtitle="Everything tracked in the walk-in, most urgent first."
            action={
              <Button variant="secondary" className="h-9" onClick={() => goToTab('ordering')}>
                Update stock
              </Button>
            }
          />
          {rows.length === 0 ? (
            <Empty icon={PackageOpen} title="Nothing tracked yet" body="Add an item in Smart ordering and it will show up here with days of cover and price direction." />
          ) : (
            <div className="overflow-x-auto px-2 pb-3">
              <table className="w-full min-w-[760px] text-left text-[13.5px]">
                <thead>
                  <tr className="text-[12px] text-faint">
                    {['Item', 'In stock', 'Daily use', 'Days of cover', 'Shelf life', 'Status', 'Price next week', ''].map((h) => (
                      <th key={h} className="px-3 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const tone = statusTone(r.status_color);
                    const trend = r.price_trend;
                    const change = parseFloat(trend.percentage.replace(/[^\d.-]/g, '')) || 0;
                    return (
                      <tr key={r.id} className="border-t border-line hover:bg-surface-2">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <ProduceTile name={r.ingredient} size="sm" />
                            <span className="font-semibold">{r.ingredient}</span>
                          </div>
                        </td>
                        <td className="tabular px-3 py-3">{r.current_stock}</td>
                        <td className="tabular px-3 py-3 text-muted">{r.daily_usage}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-20">
                              <Meter value={num(r.days_left) / 14} tone={tone} label={`${r.ingredient} days of cover`} />
                            </div>
                            <span className="tabular">{num(r.days_left).toFixed(1)}</span>
                          </div>
                        </td>
                        <td className="tabular px-3 py-3 text-muted">{r.shelf_life}</td>
                        <td className="px-3 py-3">
                          <Pill tone={tone}>{statusLabel(r.status)}</Pill>
                        </td>
                        <td className="px-3 py-3">
                          <Delta value={trend.trend === 'falling' ? -Math.abs(change) : Math.abs(change)} upIsGood={false} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Button variant={r.action === 'Order Now' ? 'primary' : 'ghost'} className="h-8 px-3 text-[12.5px]" onClick={() => orderItem(r.ingredient)}>
                            {r.action === 'Order Now' ? 'Order' : 'Plan'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function KpiTile({ label, loading, children }: { label: string; loading?: boolean; children: React.ReactNode }) {
  return (
    <div className="border-line p-4 [&:not(:first-child)]:border-l max-md:[&:nth-child(3)]:border-l-0 max-md:[&:nth-child(n+3)]:border-t">
      <div className="text-[12.5px] font-semibold text-muted">{label}</div>
      {loading ? <Skeleton className="mt-2 h-8 w-24" /> : <div className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{children}</div>}
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium tracking-normal text-faint">{children}</div>;
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx('inline-block h-2.5 w-2.5 rounded-full', className)} />
      {label}
    </span>
  );
}

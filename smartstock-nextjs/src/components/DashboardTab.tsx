'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useCommodityState } from '../contexts/CommodityContext';
import { qs, useApi } from '@/lib/api';
import { greeting } from '@/lib/hooks';
import type { ActiveForecast, InventoryRow, Kpis, SevenDay, TrendChart, Volatility, Weather } from '@/lib/types';
import { num } from '@/lib/weather';
import { count, verb } from '@/lib/words';
import { LazyMount, type RangePoint, type SeriesPoint } from './charts';
import AnomalyCard from './overview/AnomalyCard';
import ChefName from './overview/ChefName';
import ConeCard from './overview/ConeCard';
import MarketPulse from './overview/MarketPulse';
import { CoverDial, OrderList, SkillStrip } from './overview/WalkInCards';
import WeatherCard from './overview/WeatherCard';
import { produceMeta } from './produce/ProduceIcon';
import { PageHeader, Segmented, money } from './ui';

type Period = 'week' | 'month';

const PERIOD = {
  week: { short: '7 days', phrase: 'over the next 7 days', label: 'in 7 days' },
  month: { short: '4 weeks', phrase: 'over the next 4 weeks', label: 'in 4 weeks' },
};

const pct = (from: number, to: number) => (from ? ((to - from) / from) * 100 : 0);

export default function DashboardTab() {
  const { commodities, selectedCommodity, selectedState, selectedZipCode, priceUnit } = useCommodityState();
  const unit = priceUnit(selectedCommodity);
  const place = qs({ state: selectedState, zip_code: selectedZipCode });
  const [period, setPeriod] = useState<Period>('week');

  const trends = useApi<TrendChart>(`/30-day-trends?${qs({ commodity: selectedCommodity })}&${place}`);
  const week = useApi<SevenDay>(`/7-day-prediction?${qs({ commodity: selectedCommodity })}&${place}`);
  const volatility = useApi<Volatility>(`/market-volatility?${qs({ commodity: selectedCommodity })}`);
  const kpis = useApi<Kpis>('/dashboard/kpi');
  const inventory = useApi<{ inventory: InventoryRow[] }>('/inventory/list');
  const weather = useApi<Weather>(`/weather?${place}&days=7`);
  // A forecast the chef applied in the Forecast Studio wins over the built-in one (404 until that API exists)
  const active = useApi<{ items: ActiveForecast[] }>(`/forecast/active?${qs({ commodity: selectedCommodity })}`);

  // Opening a commodity trains its model on first use, so refresh accuracy once its trend arrives
  const { reload: reloadKpis } = kpis;
  useEffect(() => {
    if (trends.data) reloadKpis();
  }, [trends.data, reloadKpis]);

  const trendData = trends.data?.data;
  const series = useMemo(() => {
    const byName = (name: string) => trendData?.find((t) => t.name === name);
    const actualTrace = byName('Actual Price');
    const actual: SeriesPoint[] = actualTrace ? actualTrace.x.map((x, i) => ({ date: x.slice(0, 10), value: actualTrace.y[i] })) : [];
    const f = byName('Forecast');
    const up = byName('Upper Bound');
    const low = byName('Lower Bound');
    const monthForecast: RangePoint[] = f ? f.x.map((x, i) => ({ date: x.slice(0, 10), value: f.y[i], hi: up?.y[i], lo: low?.y[i] })) : [];
    return { actual, monthForecast };
  }, [trendData]);

  const weekForecast = useMemo<RangePoint[]>(() => {
    const w = week.data;
    if (!w?.dates?.length) return [];
    return w.predictions.map((p, i) => ({ date: (w.dates[i] ?? '').slice(0, 10), value: p.price })).filter((p) => p.date);
  }, [week.data]);

  const studio = active.data?.items?.find((i) => i.commodity === selectedCommodity) ?? active.data?.items?.[0];
  // The applied studio forecast, only for weeks after the newest real price: after a data refresh its earlier
  // weeks are history, and if none are left the cone falls back to the built-in model instead of a stale line
  const lastActual = series.actual.length ? series.actual[series.actual.length - 1].date : '';
  const studioForecast = useMemo<RangePoint[]>(
    () =>
      studio?.commodity === selectedCommodity
        ? studio.forecast.map((p) => ({ date: p.date.slice(0, 10), value: p.yhat, lo: p.lo, hi: p.hi })).filter((p) => p.date > lastActual)
        : [],
    [studio, selectedCommodity, lastActual]
  );

  const heroForecast = period === 'week' ? weekForecast : series.monthForecast;
  const coneForecast = studioForecast.length ? studioForecast : series.monthForecast;

  const rows = useMemo(() => inventory.data?.inventory ?? [], [inventory.data]);
  const needsOrder = rows.filter((r) => r.status_color === 'red' || r.status_color === 'yellow');
  const soonest = rows.length ? Math.min(...rows.map((r) => num(r.days_left))) : undefined;

  const details = kpis.data?.forecast_accuracy.accuracy_details ?? {};
  const detail = details[selectedCommodity];

  const current = series.actual.at(-1)?.value;
  const heroEnd = heroForecast.at(-1)?.value;
  const change = current !== undefined && heroEnd !== undefined ? pct(current, heroEnd) : undefined;
  const label = produceMeta(selectedCommodity).label;
  const v = volatility.data;

  return (
    <>
      <PageHeader
        crumb={
          <>
            <MapPin className="h-3.5 w-3.5" />
            <span>Kitchen in {selectedZipCode}</span>
          </>
        }
        title={
          <>
            {greeting()}, <ChefName />
          </>
        }
        summary={
          // Reserves the sentence's loaded height (2 lines on desktop, ~4 on a phone at 15px/1.625): it starts as
          // one line and grows when prices arrive, which pushed every card below it down (Lighthouse CLS 0.24)
          <span className="block min-h-[6.5em] sm:min-h-[3.25em]">
            {needsOrder.length > 0 ? (
              <>
                <b>{count(needsOrder.length, 'item')}</b> {needsOrder.length === 1 ? 'needs' : 'need'} ordering soon
              </>
            ) : rows.length ? (
              <>The walk-in is in good shape</>
            ) : (
              <>Nothing is logged in the walk-in yet</>
            )}
            {soonest !== undefined && (
              <>
                , and the first item runs out in <b>{soonest.toFixed(1)} days</b>
              </>
            )}
            .{' '}
            {change !== undefined && current !== undefined && (
              <>
                {label} {verb(label, 'are', 'is')} at <b>{money(current)}{unit}</b> and forecast to{' '}
                <b>{Math.abs(change) < 0.5 ? 'hold steady' : `${change > 0 ? 'rise' : 'fall'} ${Math.abs(change).toFixed(1)}%`}</b> {PERIOD[period].phrase}.
              </>
            )}
          </span>
        }
        actions={
          <Segmented
            label="Forecast period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'week', label: PERIOD.week.short },
              { value: 'month', label: PERIOD.month.short },
            ]}
          />
        }
      />

      <div className="stagger grid gap-4 lg:grid-cols-12">
        <MarketPulse
          commodity={selectedCommodity}
          unit={unit}
          actual={series.actual}
          forecast={heroForecast}
          horizonLabel={PERIOD[period].label}
          loading={trends.loading}
          error={trends.error}
          onRetry={trends.reload}
          mae={detail?.mae}
          skillPct={detail?.skill_pct}
          volatility={v ? { score: v.volatility_score, level: v.volatility_level, swing: v.expected_price_swing } : undefined}
        />
        <ConeCard
          commodity={selectedCommodity}
          unit={unit}
          actual={series.actual}
          forecast={coneForecast}
          loading={trends.loading}
          source={studioForecast.length && studio ? { kind: 'studio', model: studio.model_name, appliedAt: studio.applied_at } : { kind: 'model' }}
        />
        <AnomalyCard commodity={selectedCommodity} unit={unit} actual={series.actual} inventory={rows} />
        <CoverDial rows={rows} loading={inventory.loading} />
        <OrderList rows={rows} loading={inventory.loading} />
        <WeatherCard weather={weather.data} loading={weather.loading} zip={selectedZipCode} impact={week.data?.weather_impact} />
        <LazyMount height={360} className="lg:col-span-4 [&>*]:h-full">
          <SkillStrip commodities={commodities} details={details} selected={selectedCommodity} />
        </LazyMount>
      </div>
    </>
  );
}

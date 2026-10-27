'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Droplets, PackageOpen, PackagePlus, Pencil, ShoppingCart, Sparkles } from 'lucide-react';
import { useCommodity } from '../contexts/CommodityContext';
import { postJSON, qs, useApi } from '@/lib/api';
import type { InventoryRow, Recommendation, SevenDay, Weather } from '@/lib/types';
import Chart, { CHART } from './Chart';
import { weatherIcon } from './DashboardTab';
import { Button, Card, CardHeader, Empty, ErrorNote, Field, PageHeader, Pill, ProduceTile, Segmented, Select, Skeleton, money, statusLabel, statusTone, type Tone } from './ui';

const num = (s: string) => parseFloat(s) || 0;

// The API phrases reasons like "🆕 STARTER INVENTORY: Begin with 40 lbs…"; split the shouty tag from the sentence
const splitReason = (reason = '') => {
  const m = reason.match(/^[^A-Za-z]*([A-Z][A-Z &/-]+):\s*([\s\S]*)$/);
  if (!m) return { tag: undefined, text: reason };
  const tag = m[1].toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return { tag, text: m[2] };
};

const urgencyTone = (u: string): Tone => (u === 'high' ? 'bad' : u === 'medium' ? 'warn' : 'good');

export default function OrderingTab({ onInventoryChange }: { onInventoryChange?: () => void }) {
  const { commodities, selectedCommodity, setSelectedCommodity, selectedState, selectedZipCode, setSelectedZipCode, priceUnit } = useCommodity();
  const unit = priceUnit(selectedCommodity);

  const inventory = useApi<{ inventory: InventoryRow[] }>('/inventory/list');
  const recommendation = useApi<Recommendation>(`/inventory/smart-recommendation/${encodeURIComponent(selectedCommodity)}?${qs({ state: selectedState, zip_code: selectedZipCode })}`);
  const weather = useApi<Weather>(`/weather?${qs({ state: selectedState, zip_code: selectedZipCode, days: 7 })}`);

  const rows = useMemo(() => inventory.data?.inventory ?? [], [inventory.data]);
  const tracked = rows.find((r) => r.ingredient === selectedCommodity);

  // Stock form, prefilled from the walk-in when the item is already tracked
  const [form, setForm] = useState({ stock: '', usage: '', capacity: '' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const trackedStock = tracked?.current_stock;
  const trackedUsage = tracked?.daily_usage;
  useEffect(() => {
    setForm({ stock: trackedStock ? String(num(trackedStock)) : '', usage: trackedUsage ? String(num(trackedUsage)) : '', capacity: '' });
  }, [selectedCommodity, trackedStock, trackedUsage]);
  useEffect(() => setNotice(null), [selectedCommodity]);

  // 7-day outlook follows the selected commodity
  const week = useApi<SevenDay>(`/7-day-prediction?${qs({ commodity: selectedCommodity, zip_code: selectedZipCode })}`);

  // ZIP is edited locally and committed when it's a full 5 digits
  const [zip, setZip] = useState(selectedZipCode);
  useEffect(() => setZip(selectedZipCode), [selectedZipCode]);

  const refreshAll = () => {
    inventory.reload();
    recommendation.reload();
    onInventoryChange?.();
  };

  const saveStock = async (e: React.FormEvent) => {
    e.preventDefault();
    const stock = parseFloat(form.stock);
    const usage = parseFloat(form.usage);
    const capacity = parseFloat(form.capacity) || Math.max(stock * 2, usage * 14);
    if (!(stock >= 0) || !(usage > 0)) {
      setNotice({ tone: 'bad', text: 'Enter how much is in stock and how much you use a day.' });
      return;
    }
    setSaving(true);
    try {
      await postJSON('/inventory/update', { ingredient: selectedCommodity, current_stock: stock, daily_usage: usage, max_capacity: capacity, unit: 'lbs' });
      setNotice({ tone: 'good', text: `${selectedCommodity} stock saved.` });
      refreshAll();
    } catch (err) {
      setNotice({ tone: 'bad', text: `Couldn't save stock: ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const [ordering, setOrdering] = useState(false);
  const [ordered, setOrdered] = useState<string | null>(null);
  const placeOrder = async () => {
    const r = recommendation.data;
    if (!r) return;
    setOrdering(true);
    try {
      await postJSON('/inventory/confirm-order', { ingredient: selectedCommodity, quantity: r.recommended_quantity, price_per_unit: r.current_price, unit: 'lbs' });
      setOrdered(`Ordered ${r.recommended_quantity} lbs of ${selectedCommodity} for ${money(r.total_cost)}.`);
      refreshAll();
    } catch (err) {
      setOrdered(`Couldn't place the order: ${(err as Error).message}`);
    } finally {
      setOrdering(false);
    }
  };
  useEffect(() => setOrdered(null), [selectedCommodity]);

  const rec = recommendation.data;
  const reason = splitReason(rec?.reason);

  const prices = week.data?.predictions ?? [];
  const spread = prices.length ? Math.max(...prices.map((p) => p.price)) - Math.min(...prices.map((p) => p.price)) : 0;
  const flat = spread < 0.005;
  const cheapest = prices.length && !flat ? prices.reduce((best, p, i) => (p.price < prices[best].price ? i : best), 0) : -1;

  return (
    <>
      <PageHeader
        crumb={<>Plan <span className="mx-1.5">›</span> Smart ordering</>}
        title="Smart ordering"
        summary={<>Log what&apos;s in the walk-in and SmartStock times the next order around the price forecast and shelf life.</>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Log stock */}
        <Card>
          <CardHeader title="Log stock" subtitle={tracked ? 'Update today’s count for this item.' : 'Add an item to start tracking it.'} />
          <form onSubmit={saveStock} className="space-y-4 px-5 pb-5">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-ink">Item</span>
              <Select value={selectedCommodity} onChange={(e) => setSelectedCommodity(e.target.value)} aria-label="Item">
                {commodities.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="In stock" type="number" inputMode="decimal" min={0} step="any" suffix="lbs" placeholder="40" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
              <Field label="Daily use" type="number" inputMode="decimal" min={0} step="any" suffix="lbs" placeholder="12" value={form.usage} onChange={(e) => setForm({ ...form, usage: e.target.value })} />
            </div>
            <Field
              label="Storage space"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              suffix="lbs"
              placeholder="Optional"
              hint="Caps the recommended order size."
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
            {notice && (notice.tone === 'bad' ? <ErrorNote>{notice.text}</ErrorNote> : <p className="flex items-center gap-2 text-[13px] font-semibold text-good"><CheckCircle2 className="h-4 w-4" />{notice.text}</p>)}
            <Button type="submit" variant="primary" icon={PackagePlus} loading={saving} className="w-full">
              {tracked ? 'Update stock' : 'Save stock'}
            </Button>
          </form>
        </Card>

        {/* Recommendation */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recommended order"
            subtitle={`For ${selectedCommodity}, based on stock, shelf life and next week's prices.`}
            action={rec && <Pill tone={urgencyTone(rec.urgency)}>{rec.urgency === 'high' ? 'Order today' : rec.urgency === 'medium' ? 'Order this week' : 'No rush'}</Pill>}
          />
          <div className="px-5 pb-5">
            {recommendation.error ? (
              <ErrorNote>Couldn&apos;t get a recommendation: {recommendation.error}</ErrorNote>
            ) : !rec ? (
              <Skeleton className="h-48" />
            ) : (
              <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
                <div className="rounded-[18px] bg-side p-5 text-side-ink">
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-side-ink/60">
                    <Sparkles className="h-4 w-4 text-harvest" /> SmartStock suggests
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="tabular text-[44px] font-semibold leading-none tracking-[-0.03em] text-white">{rec.recommended_quantity}</span>
                    <span className="text-[16px] font-semibold text-side-ink/70">lbs</span>
                  </div>
                  <div className="tabular mt-2 text-[14px] text-side-ink/80">
                    at {money(rec.current_price)}{unit} · <b className="font-semibold text-white">{money(rec.total_cost)}</b> total
                  </div>
                  <Button variant="harvest" icon={ShoppingCart} loading={ordering} onClick={placeOrder} className="mt-5 w-full" disabled={rec.recommended_quantity <= 0}>
                    Place order for {rec.recommended_quantity} lbs
                  </Button>
                  {ordered && <p className="mt-3 text-[12.5px] text-side-ink/80">{ordered}</p>}
                </div>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-3 gap-2">
                    <MiniStat label="On hand" value={`${rec.current_stock} lbs`} />
                    <MiniStat label="Cover" value={`${rec.current_days_left.toFixed(1)} d`} />
                    <MiniStat label="Trend" value={rec.price_trend === 'stable' ? 'Steady' : `${rec.trend_percentage > 0 ? '+' : ''}${rec.trend_percentage.toFixed(1)}%`} />
                  </div>
                  <div>
                    {reason.tag && <Pill tone={/critical|urgent/i.test(reason.tag) ? 'bad' : /low|soon/i.test(reason.tag) ? 'warn' : 'info'} dot={false}>{reason.tag}</Pill>}
                    <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{reason.text}</p>
                  </div>
                  {rec.weather_impact && <p className="border-t border-line pt-3 text-[12.5px] leading-relaxed text-faint">{rec.weather_impact.explanation}</p>}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* 7-day outlook */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Best day to buy"
            subtitle={
              cheapest >= 0
                ? `${selectedCommodity} is cheapest ${prices[cheapest].day === 'Today' ? 'today' : `on ${prices[cheapest].day}`}, ${money(spread)}${unit} below the week's high.`
                : prices.length
                ? `${selectedCommodity} holds near ${money(prices[0].price)}${unit} all week, so order when it suits your deliveries.`
                : 'Predicted price for each of the next seven days.'
            }
            action={
              rows.length > 1 && (
                <Segmented
                  label="Tracked item"
                  value={rows.some((r) => r.ingredient === selectedCommodity) ? selectedCommodity : rows[0].ingredient}
                  onChange={setSelectedCommodity}
                  options={rows.slice(0, 4).map((r) => ({ value: r.ingredient, label: r.ingredient }))}
                />
              )
            }
          />
          <div className="h-[260px] px-3 pb-4">
            {prices.length ? (
              <Chart
                data={[
                  {
                    x: prices.map((p) => p.day),
                    y: prices.map((p) => p.price),
                    type: 'bar',
                    marker: { color: prices.map((_, i) => (i === cheapest ? CHART.brass : CHART.primary)) },
                    hovertemplate: `%{x}: $%{y:.2f}${unit}<extra></extra>`,
                  },
                ]}
                layout={{
                  yaxis: { tickprefix: '$', tickformat: '.2f', range: [Math.min(...prices.map((p) => p.price)) * (flat ? 0.8 : 0.97), Math.max(...prices.map((p) => p.price)) * (flat ? 1.1 : 1.02)] },
                  hovermode: 'closest',
                }}
              />
            ) : (
              <Skeleton className="h-full" />
            )}
          </div>
        </Card>

        {/* Weather */}
        <Card>
          <CardHeader title="Weather at your kitchen" subtitle="Growing conditions shift next week's prices." />
          <div className="px-5 pb-5">
            <Field
              label="ZIP code"
              inputMode="numeric"
              maxLength={5}
              value={zip}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 5);
                setZip(v);
                if (v.length === 5) setSelectedZipCode(v);
              }}
            />
            <ul className="mt-4 divide-y divide-line">
              {weather.data
                ? weather.data.forecast.slice(0, 6).map((d) => {
                    const Icon = weatherIcon(d.condition);
                    return (
                      <li key={d.date} className="flex items-center gap-3 py-2 text-[13px]">
                        <span className="w-10 font-semibold text-muted">{new Date(`${d.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}</span>
                        <Icon className="h-4 w-4 text-muted" />
                        <span className="flex-1 truncate text-muted">{d.condition}</span>
                        <span className="flex items-center gap-1 text-faint">
                          <Droplets className="h-3.5 w-3.5" />
                          {Math.round(d.humidity)}%
                        </span>
                        <span className="tabular w-16 text-right font-semibold">
                          {Math.round(d.temp_high)}° <span className="font-medium text-faint">{Math.round(d.temp_low)}°</span>
                        </span>
                      </li>
                    );
                  })
                : [0, 1, 2, 3].map((i) => <Skeleton key={i} className="my-2 h-7" />)}
            </ul>
          </div>
        </Card>

        {/* Walk-in */}
        <Card className="lg:col-span-3">
          <CardHeader title="In the walk-in" subtitle="Select an item to update its count or see its order plan." />
          {rows.length === 0 ? (
            <Empty icon={PackageOpen} title="Nothing tracked yet" body="Log stock for your first item above. SmartStock keeps up to four items in this demo." />
          ) : (
            <ul className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-4">
              {rows.map((r) => {
                const active = r.ingredient === selectedCommodity;
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelectedCommodity(r.ingredient)}
                      className={`w-full rounded-tile border p-3.5 text-left transition-colors ${active ? 'border-primary/40 bg-primary/[0.05] ring-1 ring-primary/20' : 'border-line hover:bg-surface-2'}`}
                    >
                      <div className="flex items-center gap-3">
                        <ProduceTile name={r.ingredient} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-semibold">{r.ingredient}</div>
                          <div className="text-[12.5px] text-muted">{num(r.days_left).toFixed(1)} days of cover</div>
                        </div>
                        <Pencil className="h-4 w-4 text-faint" />
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <Pill tone={statusTone(r.status_color)}>{statusLabel(r.status)}</Pill>
                        <span className="tabular text-[12.5px] text-muted">{r.current_stock}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-tile bg-surface-2 px-3 py-2.5">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="tabular mt-0.5 text-[15px] font-semibold">{value}</div>
    </div>
  );
}

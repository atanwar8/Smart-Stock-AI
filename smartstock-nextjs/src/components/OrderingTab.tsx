'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, PackageOpen, PackagePlus, ShoppingCart } from 'lucide-react';
import { useCommodityActions, useCommodityState } from '../contexts/CommodityContext';
import { getJSON, postJSON, qs, useApi } from '@/lib/api';
import { planOrders } from '@/lib/orderPlan';
import type { InventoryRow, Recommendation, SevenDay } from '@/lib/types';
import { num, weekday } from '@/lib/weather';
import { count, verb } from '@/lib/words';
import { Bars } from './charts';
import OrderCalendar, { type CalendarView } from './ordering/OrderCalendar';
import ProduceIcon, { produceMeta } from './produce/ProduceIcon';
import ZipCodeInput from './ZipCodeInput';
import { Button, Card, CardHeader, Empty, ErrorNote, Field, Micro, PageHeader, Pill, Skeleton, money, statusLabel, statusTone, type Tone } from './ui';

// The API phrases reasons like "STARTER INVENTORY: Begin with 40 lbs…"; split the shouty tag from the sentence
const splitReason = (reason = '') => {
  const m = reason.match(/^[^A-Za-z]*([A-Z][A-Z &/-]+):\s*([\s\S]*)$/);
  if (!m) return { tag: undefined, text: reason };
  const tag = m[1].toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return { tag, text: m[2] };
};

const urgencyTone = (u: string): Tone => (u === 'high' ? 'bad' : u === 'medium' ? 'warn' : 'good');

export default function OrderingTab({ onInventoryChange }: { onInventoryChange?: () => void }) {
  const { selectedCommodity, selectedState, selectedZipCode, priceUnit } = useCommodityState();
  const { setSelectedCommodity } = useCommodityActions();
  const unit = priceUnit(selectedCommodity);
  const label = produceMeta(selectedCommodity).label;
  const place = qs({ state: selectedState, zip_code: selectedZipCode });

  const inventory = useApi<{ inventory: InventoryRow[] }>('/inventory/list');
  const recommendation = useApi<Recommendation>(`/inventory/smart-recommendation/${encodeURIComponent(selectedCommodity)}?${place}`);
  const week = useApi<SevenDay>(`/7-day-prediction?${qs({ commodity: selectedCommodity, zip_code: selectedZipCode })}`);

  const rows = useMemo(() => inventory.data?.inventory ?? [], [inventory.data]);
  const tracked = rows.find((r) => r.ingredient === selectedCommodity);

  // Current price for every tracked item, so the calendar can price each planned order
  const ingredients = rows.map((r) => r.ingredient).join('|');
  const [prices, setPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!ingredients) return;
    let cancelled = false;
    Promise.allSettled(
      ingredients.split('|').map((c) => getJSON<Recommendation>(`/inventory/smart-recommendation/${encodeURIComponent(c)}?${place}`).then((r) => [c, r.current_price] as const))
    ).then((results) => {
      if (!cancelled) setPrices(Object.fromEntries(results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))));
    });
    return () => {
      cancelled = true;
    };
  }, [ingredients, place]);

  /* ---------- Order calendar ---------- */
  const [today] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>('month');
  const orders = useMemo(() => planOrders(rows, prices, today, new Date(today.getFullYear() + 1, today.getMonth() + 1, 0)), [rows, prices, today]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [lastSkipped, setLastSkipped] = useState<string | null>(null);
  const toggleSkip = useCallback(
    (key: string) => {
      const next = new Set(skipped);
      if (next.has(key)) {
        next.delete(key);
        setLastSkipped(null);
      } else {
        next.add(key);
        setLastSkipped(key);
      }
      setSkipped(next);
    },
    [skipped]
  );
  const undoSkip = useCallback(() => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (lastSkipped) next.delete(lastSkipped);
      return next;
    });
    setLastSkipped(null);
  }, [lastSkipped]);

  /* ---------- Best day to buy ---------- */
  const prices7 = useMemo(() => week.data?.predictions ?? [], [week.data]);
  const dates7 = week.data?.dates ?? [];
  const spread = prices7.length ? Math.max(...prices7.map((p) => p.price)) - Math.min(...prices7.map((p) => p.price)) : 0;
  const flat = spread < 0.005;
  const cheapest = prices7.length && !flat ? prices7.reduce((best, p, i) => (p.price < prices7[best].price ? i : best), 0) : -1;
  const dayName = (i: number) => (i === 0 ? 'today' : dates7[i] ? weekday(dates7[i].slice(0, 10)) : prices7[i]?.day ?? '');

  const rec = recommendation.data;
  const qtyForSavings = rec?.recommended_quantity || (tracked ? Math.round(num(tracked.daily_usage) * 7) : 0);
  const savings = cheapest >= 0 && qtyForSavings > 0 ? { amount: spread * qtyForSavings, text: `buying ${label.toLowerCase()} ${cheapest === 0 ? 'today' : `on ${dayName(cheapest)}`}` } : undefined;

  /* ---------- Stock form ---------- */
  const [form, setForm] = useState({ stock: '', usage: '', capacity: '' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const trackedStock = tracked?.current_stock;
  const trackedUsage = tracked?.daily_usage;
  useEffect(() => {
    setForm({ stock: trackedStock ? String(num(trackedStock)) : '', usage: trackedUsage ? String(num(trackedUsage)) : '', capacity: '' });
  }, [selectedCommodity, trackedStock, trackedUsage]);
  useEffect(() => setNotice(null), [selectedCommodity]);

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
      setNotice({ tone: 'good', text: `${label} saved.` });
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
    if (!rec) return;
    setOrdering(true);
    try {
      await postJSON('/inventory/confirm-order', { ingredient: selectedCommodity, quantity: rec.recommended_quantity, price_per_unit: rec.current_price, unit: 'lbs' });
      setOrdered(`Ordered ${rec.recommended_quantity} lbs of ${label.toLowerCase()} for ${money(rec.total_cost)}.`);
      refreshAll();
    } catch (err) {
      setOrdered(`Couldn't place the order: ${(err as Error).message}`);
    } finally {
      setOrdering(false);
    }
  };
  useEffect(() => setOrdered(null), [selectedCommodity]);

  const reason = splitReason(rec?.reason);
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const monthOrders = orders.filter((o) => o.date.startsWith(monthKey) && !skipped.has(o.key));
  const monthSpend = monthOrders.reduce((s, o) => s + (o.spend ?? 0), 0);

  return (
    <>
      <PageHeader
        crumb={<span>Plan your deliveries</span>}
        title="Smart ordering"
        summary={
          rows.length ? (
            <>
              <b>{count(monthOrders.length, 'order')}</b> planned for the rest of this month, about <b>{money(monthSpend, 0)}</b>.{' '}
              {cheapest >= 0 ? (
                <>
                  {label} {verb(label, 'are', 'is')} cheapest <b>{cheapest === 0 ? 'today' : `on ${dayName(cheapest)}`}</b> this week.
                </>
              ) : prices7.length ? (
                <>
                  {label} {verb(label, 'hold', 'holds')} near <b>{money(prices7[0].price)}{unit}</b> all week.
                </>
              ) : null}
            </>
          ) : (
            <>Log what&apos;s in the walk-in and SmartStock plans each order around the price forecast and shelf life.</>
          )
        }
      />

      <div className="stagger grid gap-4 lg:grid-cols-12">
        <OrderCalendar
          orders={orders}
          skipped={skipped}
          onToggle={toggleSkip}
          lastSkipped={lastSkipped}
          onUndo={undoSkip}
          view={view}
          onViewChange={setView}
          savings={savings}
          today={today}
        />

        {/* Recommendation: the page's night card */}
        <Card tone="night" label={`Recommended ${label.toLowerCase()} order`} className="flex flex-col lg:col-span-4">
          <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-white/[0.07] ring-1 ring-white/10">
                <ProduceIcon commodity={selectedCommodity} size={30} animated />
              </span>
              <div className="leading-tight">
                <div className="text-[15px] font-semibold text-white">Next order</div>
                <Micro className="text-night-ink/55">{label}</Micro>
              </div>
            </div>
            {rec && (
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-semibold text-night-ink">
                {rec.urgency === 'high' ? 'Order today' : rec.urgency === 'medium' ? 'This week' : 'No rush'}
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-col px-5 pb-5 pt-5 sm:px-6">
            {recommendation.error ? (
              <p className="rounded-tile bg-white/[0.06] px-3.5 py-2.5 text-[13px] text-[#fda4af]">Couldn&apos;t get a recommendation: {recommendation.error}</p>
            ) : !rec ? (
              <div className="space-y-3">
                <Skeleton night className="h-16 w-40" />
                <Skeleton night className="h-4 w-56 rounded-full" />
                <Skeleton night className="h-24" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="tabular font-display text-[72px] leading-[0.85] text-white">{rec.recommended_quantity}</span>
                  <span className="text-[15px] font-medium text-night-ink/60">lbs</span>
                </div>
                <p className="tabular mt-3 text-[13.5px] text-night-ink/70">
                  at {money(rec.current_price)}
                  {unit}, <b className="font-semibold text-white">{money(rec.total_cost)}</b> in total
                </p>
                <dl className="mt-5 grid grid-cols-3 gap-2">
                  <NightStat label="On hand" value={`${rec.current_stock}`} note="lbs" />
                  <NightStat label="Cover" value={rec.current_days_left.toFixed(1)} note="days" />
                  <NightStat label="Trend" value={rec.price_trend === 'stable' ? 'Flat' : `${rec.trend_percentage > 0 ? '+' : ''}${rec.trend_percentage.toFixed(1)}%`} note="7 days" />
                </dl>
                <p className="mt-4 text-[13px] leading-relaxed text-night-ink/70">
                  {reason.tag && <b className="font-semibold text-white">{reason.tag}. </b>}
                  {reason.text}
                </p>
                <div className="mt-auto pt-5">
                  <Button variant="night" icon={ShoppingCart} loading={ordering} onClick={placeOrder} className="w-full" disabled={rec.recommended_quantity <= 0}>
                    Place order for {rec.recommended_quantity} lbs
                  </Button>
                  {ordered && (
                    <p role="status" className="mt-3 text-[12.5px] text-night-ink/80">
                      {ordered}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Log stock */}
        <Card label="Log stock" className="lg:col-span-4">
          <CardHeader title="Log stock" subtitle={tracked ? `Update today's count for ${label.toLowerCase()}.` : `Start tracking ${label.toLowerCase()}.`} action={<ProduceIcon commodity={selectedCommodity} size={36} bubble />} />
          <form onSubmit={saveStock} className="space-y-4 px-5 pb-5 sm:px-6">
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
            <div className="flex items-end justify-between gap-3">
              <ZipCodeInput compact />
              <span className="text-[11.5px] text-faint">Weather shapes the advice</span>
            </div>
            {notice &&
              (notice.tone === 'bad' ? (
                <ErrorNote>{notice.text}</ErrorNote>
              ) : (
                <p role="status" className="flex items-center gap-2 text-[13px] font-semibold text-good">
                  <CheckCircle2 className="h-4 w-4" />
                  {notice.text}
                </p>
              ))}
            <Button type="submit" variant="primary" icon={PackagePlus} loading={saving} className="w-full">
              {tracked ? 'Update stock' : 'Save stock'}
            </Button>
          </form>
        </Card>

        {/* Best day to buy */}
        <Card label="Best day to buy" className="flex flex-col lg:col-span-4">
          <CardHeader
            title="Best day to buy"
            subtitle={
              cheapest >= 0
                ? `${money(spread)}${unit} less than the week's high.`
                : prices7.length
                ? 'Flat all week, so order when it suits your deliveries.'
                : 'Predicted price for each of the next seven days.'
            }
          />
          <div className="flex-1 px-4 pb-5 sm:px-5">
            {week.error ? (
              <ErrorNote>Couldn&apos;t load the week: {week.error}</ErrorNote>
            ) : prices7.length ? (
              <Bars
                data={prices7.map((p, i) => ({ key: p.day, label: i === 0 ? 'Today' : dayName(i), value: p.price, highlight: i === cheapest, note: `${i === 0 ? 'Today' : dayName(i)}: ${money(p.price)}${unit}` }))}
                baseline="auto"
                height={220}
                color="#2e6a4e"
                showValues
                animKey={selectedCommodity}
                label={`${label} predicted price for the next seven days${cheapest >= 0 ? `, cheapest ${dayName(cheapest)}` : ''}.`}
              />
            ) : (
              <Skeleton className="h-[220px]" />
            )}
          </div>
        </Card>

        {/* Walk-in */}
        <Card label="In the walk-in" className="flex flex-col lg:col-span-4">
          <CardHeader title="In the walk-in" subtitle="Select an item to update it or see its order." />
          {inventory.loading && !rows.length ? (
            <div className="space-y-2 px-5 pb-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <Empty icon={PackageOpen} title="Nothing tracked yet" body="Log stock for your first item. The demo keeps up to four items." />
          ) : (
            <ul className="space-y-1 px-3 pb-4">
              {rows.map((r) => {
                const active = r.ingredient === selectedCommodity;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedCommodity(r.ingredient)}
                      aria-pressed={active}
                      className={`flex w-full items-center gap-3 rounded-tile px-2.5 py-2 text-left transition-colors ${active ? 'bg-accent/[0.07] ring-1 ring-accent/25' : 'hover:bg-surface-2'}`}
                    >
                      <ProduceIcon commodity={r.ingredient} size={36} bubble decorative />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="tabular font-display text-[20px] leading-none">{num(r.days_left).toFixed(1)}</span>
                          <span className="text-[12px] text-muted">days</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-faint">
                          {r.ingredient}, {r.current_stock}
                        </span>
                      </span>
                      <Pill tone={statusTone(r.status_color)}>{statusLabel(r.status)}</Pill>
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

function NightStat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[14px] bg-white/[0.06] px-3 py-2.5">
      <dt className="micro text-night-ink/55">{label}</dt>
      <dd className="tabular mt-1 font-display text-[22px] leading-none text-white">{value}</dd>
      <dd className="mt-0.5 text-[11px] text-night-ink/55">{note}</dd>
    </div>
  );
}

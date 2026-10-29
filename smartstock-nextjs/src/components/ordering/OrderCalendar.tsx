'use client';

import { memo, useMemo, useState } from 'react';
import { CalendarX2, ChevronLeft, ChevronRight, Undo2 } from 'lucide-react';
import { iso, monthGrid, type PlannedOrder } from '@/lib/orderPlan';
import { Bars } from '../charts';
import ProduceIcon from '../produce/ProduceIcon';
import { Button, Card, Empty, IconButton, Micro, Segmented, cx, money } from '../ui';

export type CalendarView = 'month' | 'year';

interface OrderCalendarProps {
  orders: PlannedOrder[];
  skipped: Set<string>;
  onToggle: (key: string) => void;
  lastSkipped: string | null;
  onUndo: () => void;
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  /** e.g. "Buying tomatoes on Thu saves about $4.20" */
  savings?: { amount: number; text: string };
  today: Date;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Vencimientos-style calendar: soft produce bubbles on the days an order should go out, weekly spend bars
// beside each week, and a running total. Tapping a bubble skips that order (and Undo brings it back).
function OrderCalendarBase({ orders, skipped, onToggle, lastSkipped, onUndo, view, onViewChange, savings, today }: OrderCalendarProps) {
  const [offset, setOffset] = useState(0);
  const shown = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = shown.getFullYear();
  const month = shown.getMonth();
  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  const todayIso = iso(today);

  const byDay = useMemo(() => {
    const map = new Map<string, PlannedOrder[]>();
    for (const o of orders) map.set(o.date, [...(map.get(o.date) ?? []), o]);
    return map;
  }, [orders]);

  const live = (o: PlannedOrder) => !skipped.has(o.key);
  const monthKey = iso(shown).slice(0, 7);
  const monthOrders = orders.filter((o) => o.date.startsWith(monthKey) && live(o));
  const monthSpend = monthOrders.reduce((s, o) => s + (o.spend ?? 0), 0);

  const weekSpend = weeks.map((w) => w.reduce((s, d) => s + (d ? (byDay.get(iso(d)) ?? []).filter(live).reduce((a, o) => a + (o.spend ?? 0), 0) : 0), 0));
  const maxWeek = Math.max(1, ...weekSpend);

  // Annual: projected spend per month for the next twelve months
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const key = iso(d).slice(0, 7);
        const list = orders.filter((o) => o.date.startsWith(key) && !skipped.has(o.key));
        return { key, label: MONTHS[d.getMonth()], spend: list.reduce((s, o) => s + (o.spend ?? 0), 0), count: list.length };
      }),
    [orders, skipped, today]
  );
  const yearSpend = months.reduce((s, m) => s + m.spend, 0);
  const yearCount = months.reduce((s, m) => s + m.count, 0);

  const total = view === 'month' ? monthSpend : yearSpend;
  const totalCount = view === 'month' ? monthOrders.length : yearCount;

  return (
    <Card label="Order calendar" className="flex flex-col lg:col-span-8">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="flex items-center gap-2">
          {view === 'month' ? (
            <>
              <IconButton icon={ChevronLeft} label="Previous month" onClick={() => setOffset((o) => o - 1)} disabled={offset <= 0} className="disabled:opacity-40" />
              <h2 className="min-w-[9.5rem] text-center font-display text-[26px] leading-none text-ink" aria-live="polite">
                {shown.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </h2>
              <IconButton icon={ChevronRight} label="Next month" onClick={() => setOffset((o) => o + 1)} disabled={offset >= 11} className="disabled:opacity-40" />
            </>
          ) : (
            <h2 className="font-display text-[26px] leading-none text-ink">Next twelve months</h2>
          )}
        </div>
        <Segmented
          label="Calendar range"
          value={view}
          onChange={onViewChange}
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'year', label: 'Annual' },
          ]}
        />
      </div>

      {!orders.length ? (
        <Empty icon={CalendarX2} title="No orders to plan yet" body="Log stock and daily use for an item and its order days appear here." />
      ) : view === 'month' ? (
        <div className="px-3 pt-4 sm:px-5">
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(7,minmax(0,1fr))_76px]">
            {WEEKDAYS.map((d) => (
              <div key={d} className="micro pb-1 text-center text-faint">
                {d}
              </div>
            ))}
            <div className="micro hidden pb-1 text-right text-faint sm:block">Week</div>
            {weeks.map((week, wi) => (
              <WeekRow key={wi} week={week} byDay={byDay} skipped={skipped} onToggle={onToggle} todayIso={todayIso} spend={weekSpend[wi]} maxWeek={maxWeek} />
            ))}
          </div>
        </div>
      ) : (
        <div className="px-4 pt-5 sm:px-6">
          <Bars
            data={months.map((m, i) => ({ key: m.key, label: m.label, value: m.spend, highlight: i === 0, note: `${m.label}: ${money(m.spend, 0)} over ${m.count} orders` }))}
            height={240}
            format={(n) => money(n, 0)}
            showValues
            label={`Projected produce spend for the next twelve months, ${money(yearSpend, 0)} in total.`}
          />
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-5 py-4 sm:px-6">
        <div>
          <Micro className="text-faint">{view === 'month' ? 'This month' : 'Twelve months'}</Micro>
          <div className="flex items-baseline gap-2">
            <span className="tabular font-display text-[34px] leading-none text-ink">{money(total, 0)}</span>
            <span className="text-[12.5px] text-muted">{totalCount} orders</span>
          </div>
        </div>
        {savings && savings.amount >= 0.5 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-good/10 px-3 py-1 text-[12.5px] font-semibold text-good" title={savings.text}>
            You save {money(savings.amount)}
            <span className="hidden font-medium text-good/80 sm:inline">{savings.text}</span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {lastSkipped && (
            <Button size="sm" icon={Undo2} onClick={onUndo}>
              Undo skip
            </Button>
          )}
          {!lastSkipped && view === 'month' && <span className="hidden text-[12px] text-faint md:inline">Tap a symbol to skip that order.</span>}
        </span>
      </div>
    </Card>
  );
}

function WeekRow({
  week,
  byDay,
  skipped,
  onToggle,
  todayIso,
  spend,
  maxWeek,
}: {
  week: (Date | null)[];
  byDay: Map<string, PlannedOrder[]>;
  skipped: Set<string>;
  onToggle: (key: string) => void;
  todayIso: string;
  spend: number;
  maxWeek: number;
}) {
  return (
    <>
      {week.map((d, i) => {
        if (!d) return <div key={i} aria-hidden="true" />;
        const key = iso(d);
        const list = byDay.get(key) ?? [];
        const isToday = key === todayIso;
        const past = key < todayIso;
        return (
          <div
            key={i}
            className={cx(
              'relative flex min-h-[58px] flex-col rounded-[14px] p-1.5 sm:min-h-[76px] sm:p-2',
              isToday ? 'bg-ink/[0.04] ring-1 ring-ink/20' : list.length ? 'bg-surface-2' : '',
              past && 'opacity-45'
            )}
          >
            <span className={cx('tabular font-mono text-[11px]', isToday ? 'font-semibold text-ink' : 'text-faint')}>{d.getDate()}</span>
            <div className="mt-auto flex flex-wrap gap-0.5">
              {list.slice(0, 3).map((o) => {
                const off = skipped.has(o.key);
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => onToggle(o.key)}
                    aria-pressed={off}
                    aria-label={`${o.commodity} order on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${o.qty} lbs${o.spend !== undefined ? `, about ${money(o.spend, 0)}` : ''}. ${off ? 'Skipped; select to restore.' : 'Select to skip.'}`}
                    title={`${o.commodity}: ${o.qty} lbs${o.spend !== undefined ? `, ~${money(o.spend, 0)}` : ''}${off ? ' (skipped)' : ''}`}
                    className={cx('relative rounded-full transition-opacity', off && 'opacity-35')}
                  >
                    <ProduceIcon commodity={o.commodity} size={24} bubble decorative />
                    {off && <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-ink/60" />}
                  </button>
                );
              })}
              {list.length > 3 && <span className="tabular self-center font-mono text-[10px] text-faint">+{list.length - 3}</span>}
            </div>
          </div>
        );
      })}
      <div className="hidden flex-col justify-center gap-1 pl-2 sm:flex">
        <span className="h-1.5 overflow-hidden rounded-full bg-well">
          <span className="block h-full rounded-full bg-accent/80 transition-[width] duration-500 ease-spring" style={{ width: `${(spend / maxWeek) * 100}%` }} />
        </span>
        <span className="tabular text-right font-mono text-[10.5px] text-muted">{spend ? money(spend, 0) : '—'}</span>
      </div>
    </>
  );
}

export const OrderCalendar = memo(OrderCalendarBase);
export default OrderCalendar;

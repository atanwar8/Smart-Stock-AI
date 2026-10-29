'use client';

import { memo } from 'react';
import { CheckCircle2, PackageOpen } from 'lucide-react';
import { useCommodityActions } from '@/contexts/CommodityContext';
import { goToTab } from '@/lib/tabs';
import type { InventoryRow } from '@/lib/types';
import { num } from '@/lib/weather';
import { verb } from '@/lib/words';
import { Dial } from '../charts';
import { useWidth } from '../charts/hooks';
import ProduceIcon, { produceMeta } from '../produce/ProduceIcon';
import { Button, Card, CardHeader, Delta, Empty, Pill, Skeleton, statusLabel, statusTone } from '../ui';

const trendPct = (r: InventoryRow) => {
  const v = parseFloat(r.price_trend.percentage.replace(/[^\d.-]/g, '')) || 0;
  return r.price_trend.trend === 'falling' ? -Math.abs(v) : r.price_trend.trend === 'rising' ? Math.abs(v) : 0;
};

/* ---------- Days of cover: Pelago-style radial dial ---------- */

function CoverDialBase({ rows, loading }: { rows: InventoryRow[]; loading: boolean }) {
  const { setSelectedCommodity } = useCommodityActions();
  const items = rows.map((r) => ({ commodity: r.ingredient, days: num(r.days_left) }));
  const first = [...items].sort((a, b) => a.days - b.days)[0];
  // As large as the card allows, up to 340 px (was a fixed 256): the item bubbles sit on the rim, so leave ~36 px
  const [boxRef, boxWidth] = useWidth<HTMLDivElement>();
  const dialSize = Math.max(240, Math.min(340, (boxWidth || 340) - 36));

  return (
    <Card label="Days of cover in the walk-in" className="flex flex-col lg:col-span-5">
      <CardHeader
        title="Walk-in, by days of cover"
        subtitle="Each item sits on the dial at the day it runs out."
        action={
          <Button variant="ghost" size="sm" onClick={() => goToTab('ordering')}>
            Manage
          </Button>
        }
      />
      <div ref={boxRef} className="flex flex-1 items-center justify-center px-5 pb-6 pt-1">
        {loading && !rows.length ? (
          <Skeleton className="aspect-square w-[300px] max-w-full rounded-full" />
        ) : !rows.length ? (
          <Empty icon={PackageOpen} title="The walk-in is empty" body="Log what's on the shelves to see how long it lasts." action={<Button variant="primary" size="sm" onClick={() => goToTab('ordering')}>Log stock</Button>} />
        ) : (
          <Dial
            size={dialSize}
            items={items}
            onSelect={setSelectedCommodity}
            center={
              first && (
                <>
                  <span className="tabular font-display text-[64px] leading-none text-ink">{first.days.toFixed(1)}</span>
                  <span className="mt-1 text-[13.5px] leading-snug text-muted">
                    days until {produceMeta(first.commodity).label.toLowerCase()} {verb(produceMeta(first.commodity).label, 'run', 'runs')} out
                  </span>
                </>
              )
            }
          />
        )}
      </div>
    </Card>
  );
}

export const CoverDial = memo(CoverDialBase);

/* ---------- What to order ---------- */

function OrderListBase({ rows, loading }: { rows: InventoryRow[]; loading: boolean }) {
  const { setSelectedCommodity } = useCommodityActions();
  const sorted = [...rows].sort((a, b) => num(a.days_left) - num(b.days_left)).slice(0, 5);
  const due = rows.filter((r) => r.status_color === 'red' || r.status_color === 'yellow').length;

  const order = (commodity: string) => {
    setSelectedCommodity(commodity);
    goToTab('ordering');
  };

  return (
    <Card label="What to order" className="flex flex-col lg:col-span-4">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            What to order
            {due > 0 && <span className="tabular rounded-full bg-[#dd5a43] px-1.5 py-px font-mono text-[11px] font-semibold text-white">{due}</span>}
          </span>
        }
        subtitle="Soonest to run out first."
      />
      <div className="flex-1 px-3 pb-3">
        {loading && !rows.length ? (
          <div className="space-y-2 px-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !rows.length ? (
          <Empty icon={CheckCircle2} title="Nothing to order" body="Items you track show up here when they run low." />
        ) : (
          <ul>
            {sorted.map((r) => {
              const days = num(r.days_left);
              const urgent = r.status_color === 'red' || r.status_color === 'yellow';
              return (
                <li key={r.id} className="flex items-center gap-3 rounded-tile px-2 py-2.5 hover:bg-surface-2">
                  <ProduceIcon commodity={r.ingredient} size={40} bubble />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="tabular font-display text-[22px] leading-none text-ink">{days.toFixed(1)}</span>
                      <span className="text-[12.5px] text-muted">days left</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-faint">
                      <span className="truncate">{r.ingredient}</span>
                      <Delta value={trendPct(r)} upIsGood={false} />
                    </div>
                  </div>
                  {urgent ? (
                    <Button variant="primary" size="sm" onClick={() => order(r.ingredient)} aria-label={`Order ${r.ingredient}`}>
                      Order
                    </Button>
                  ) : (
                    <Pill tone={statusTone(r.status_color)}>{statusLabel(r.status)}</Pill>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

export const OrderList = memo(OrderListBase);

/* ---------- Forecast skill per produce ---------- */

type Details = Record<string, { skill_pct: number; mae: number }>;

function SkillStripBase({ commodities, details, selected }: { commodities: string[]; details: Details; selected: string }) {
  const { setSelectedCommodity } = useCommodityActions();
  return (
    <Card label="Forecast skill by produce" className="flex flex-col lg:col-span-4">
      <CardHeader title="Forecast skill" subtitle="How much smaller each model's error is than repeating last week's price." />
      <ul className="grid flex-1 grid-cols-1 gap-0.5 px-3 pb-4">
        {commodities.map((c) => {
          const skill = details[c]?.skill_pct;
          // The bar covers 0-30% better than the naive guess
          const width = skill === undefined ? 0 : Math.min(30, Math.max(0, skill)) / 30;
          const color = skill === undefined ? '' : skill >= 10 ? '#34a865' : skill > 0 ? '#d99a1e' : '#dd5a43';
          const active = c === selected;
          return (
            <li key={c}>
              <button
                type="button"
                onClick={() => setSelectedCommodity(c)}
                aria-label={`${c}: ${skill === undefined ? 'model not trained yet' : `${skill.toFixed(0)}% better than last week's price`}`}
                aria-pressed={active}
                className={['grid w-full grid-cols-[28px_1fr_3rem] items-center gap-3 rounded-[12px] px-2 py-1 text-left transition-colors', active ? 'bg-well' : 'hover:bg-surface-2'].join(' ')}
              >
                <ProduceIcon commodity={c} size={26} decorative />
                <span className="h-1.5 overflow-hidden rounded-full bg-well">
                  <span className="block h-full rounded-full transition-[width] duration-700 ease-spring" style={{ width: `${width * 100}%`, background: color }} />
                </span>
                <span className="tabular text-right font-mono text-[11.5px] text-muted">{skill === undefined ? '—' : `${skill >= 0 ? '+' : ''}${skill.toFixed(0)}%`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export const SkillStrip = memo(SkillStripBase);

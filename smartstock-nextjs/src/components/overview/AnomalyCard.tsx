'use client';

import { memo, useMemo } from 'react';
import { EyeOff, ShoppingBasket, Sparkles, Undo2 } from 'lucide-react';
import { useCommodityActions } from '@/contexts/CommodityContext';
import { useStoredState } from '@/lib/hooks';
import { goToTab } from '@/lib/tabs';
import type { InventoryRow } from '@/lib/types';
import { usualBand } from '@/lib/usual';
import { verb } from '@/lib/words';
import { AreaLine, type SeriesPoint } from '../charts';
import ProduceIcon, { produceMeta } from '../produce/ProduceIcon';
import { Button, Card, Delta, Kbd, Micro, Skeleton, money } from '../ui';

interface AnomalyCardProps {
  commodity: string;
  unit: string;
  actual: SeriesPoint[];
  inventory: InventoryRow[];
}

const longDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const trendPct = (r: InventoryRow) => {
  const v = parseFloat(r.price_trend.percentage.replace(/[^\d.-]/g, '')) || 0;
  return r.price_trend.trend === 'falling' ? -Math.abs(v) : r.price_trend.trend === 'rising' ? Math.abs(v) : 0;
};

// Atisbo-style anomaly: one sentence that explains the price, the usual band shaded around the real line,
// and the two things a chef would do next. "Not relevant" hides it until the next USDA report.
function AnomalyCardBase({ commodity, unit, actual, inventory }: AnomalyCardProps) {
  const { setSelectedCommodity } = useCommodityActions();
  const meta = produceMeta(commodity);
  const label = meta.label;
  const [dismissed, setDismissed] = useStoredState<string[]>('smartstock.anomaly.dismissed', []);

  // Usual price and band (median + robust spread), shared with the Alerts page
  const story = useMemo(() => usualBand(actual), [actual]);

  const key = story ? `${commodity}|${story.latest.date}` : '';
  const isDismissed = key !== '' && dismissed.includes(key);

  // The biggest forecast move among the other items in the walk-in, so nothing hides behind the selection
  const elsewhere = useMemo(() => {
    const others = inventory.filter((r) => r.ingredient !== commodity).map((r) => ({ name: r.ingredient, change: trendPct(r) }));
    return others.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  }, [inventory, commodity]);

  const their = verb(label, 'their', 'its');
  const be = verb(label, 'are', 'is');
  let headline = '';
  if (story) {
    if (story.ratio >= 1.1) headline = `${label} ${be} running ${story.ratio.toFixed(1)}× ${their} usual price.`;
    else if (story.ratio <= 0.9) headline = `${label} ${be} ${Math.round((1 - story.ratio) * 100)}% below ${their} usual price.`;
    else if (story.outside) headline = `${label} ${be} ${story.ratio > 1 ? 'a little above' : 'a little below'} ${their} usual price.`;
    else headline = `${label} ${be} right on ${their} usual price.`;
  }
  const notable = story ? story.ratio >= 1.1 || story.ratio <= 0.9 || story.outside : false;

  return (
    <Card label={`${label} price check`} className="flex flex-col lg:col-span-7">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <ProduceIcon commodity={commodity} size={30} bubble />
          <h2 className="text-[15px] font-semibold text-ink">Price check</h2>
          {notable && <span className="rounded-full bg-[#d99a1e]/14 px-2 py-0.5 text-[11.5px] font-semibold text-warn">Unusual</span>}
        </div>
        <span className="hidden items-center gap-1.5 text-[12px] text-faint sm:flex">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> next produce
        </span>
      </div>

      {!story ? (
        <div className="space-y-3 px-5 pb-6 pt-4 sm:px-6">
          <Skeleton className="h-9 w-4/5 rounded-[12px]" />
          <Skeleton className="h-4 w-3/5 rounded-full" />
          <Skeleton className="h-[150px]" />
        </div>
      ) : isDismissed ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-3 px-5 pb-6 pt-4 sm:px-6">
          <p className="text-[14px] text-muted">Hidden for {label.toLowerCase()} until the next USDA report.</p>
          <Button size="sm" icon={Undo2} onClick={() => setDismissed((d) => d.filter((k) => k !== key))}>
            Undo
          </Button>
        </div>
      ) : (
        <>
          <div className="px-5 pt-3 sm:px-6">
            <p className="max-w-[30ch] font-display text-[30px] leading-[1.08] text-ink sm:text-[34px]">{headline}</p>
            <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-muted [&_b]:font-semibold [&_b]:text-ink">
              Usual is <b>{money(story.usual)}{unit}</b>, the median of the previous {actual.length - 1} USDA weeks. The report for{' '}
              {longDay(story.latest.date)} says <b>{money(story.latest.value)}</b>.
            </p>
          </div>
          <div className="px-3 pt-3 sm:px-4">
            <AreaLine
              actual={actual}
              expected={story.expected}
              height={150}
              showYAxis={false}
              animKey={commodity}
              actualColor={notable ? '#b3361f' : '#2e6a4e'}
              label={`${label}: actual weekly price against its usual band. ${headline}`}
            />
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2 px-5 pb-5 pt-4 sm:px-6">
            <Button
              variant="primary"
              size="sm"
              icon={ShoppingBasket}
              onClick={() => {
                setSelectedCommodity(commodity);
                goToTab('ordering');
              }}
            >
              Plan an order
            </Button>
            <Button size="sm" icon={Sparkles} onClick={() => goToTab('predictions')}>
              See forecast
            </Button>
            <Button variant="ghost" size="sm" icon={EyeOff} onClick={() => setDismissed((d) => [...d.slice(-40), key])}>
              Not relevant
            </Button>
            <span className="ml-auto inline-flex items-center gap-3 text-[11.5px] text-faint">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-4 rounded-sm bg-well ring-1 ring-line" /> Usual range
              </span>
            </span>
          </div>
        </>
      )}

      {elsewhere && Math.abs(elsewhere.change) >= 0.5 && (
        <button
          type="button"
          onClick={() => setSelectedCommodity(elsewhere.name)}
          className="flex items-center gap-3 border-t border-line px-5 py-3 text-left text-[13px] text-muted transition-colors hover:bg-surface-2 sm:px-6"
        >
          <Micro className="text-faint">Elsewhere</Micro>
          <ProduceIcon commodity={elsewhere.name} size={24} decorative />
          <span className="min-w-0 flex-1 truncate">
            {elsewhere.name} {verb(elsewhere.name, 'are', 'is')} forecast to {elsewhere.change > 0 ? 'rise' : 'fall'} next week
          </span>
          <Delta value={elsewhere.change} upIsGood={false} />
        </button>
      )}
    </Card>
  );
}

export const AnomalyCard = memo(AnomalyCardBase);
export default AnomalyCard;

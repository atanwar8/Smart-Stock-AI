'use client';

import { memo, useEffect, useRef, type KeyboardEvent } from 'react';
import { useCommodityActions } from '@/contexts/CommodityContext';
import ProduceIcon, { produceMeta, tintAlpha } from '../produce/ProduceIcon';
import { Kbd, cx } from '../ui';

interface SwitcherProps {
  commodities: string[];
  selected: string;
}

// The produce shelf: one symbol bubble per commodity. The chosen one glows in its own tint.
// J / K (handled by the shell) and the arrow keys here move along the shelf.
function ProduceSwitcherBase({ commodities, selected }: SwitcherProps) {
  const { setSelectedCommodity } = useCommodityActions();
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the chosen symbol in view on narrow screens where the shelf scrolls (horizontally only,
  // so J/K never yanks the page back to the top)
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!list || !el) return;
    const left = el.offsetLeft - list.clientWidth / 2 + el.clientWidth / 2;
    list.scrollTo({ left, behavior: 'smooth' });
  }, [selected]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = commodities.indexOf(selected);
    const next = commodities[(i + (e.key === 'ArrowRight' ? 1 : commodities.length - 1)) % commodities.length];
    setSelectedCommodity(next);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="hidden shrink-0 text-right leading-tight xl:block">
        <div className="text-[12px] text-faint">Showing</div>
        <div className="font-display text-[19px] text-ink">{produceMeta(selected).label}</div>
      </div>
      <div
        ref={listRef}
        role="radiogroup"
        aria-label="Produce"
        onKeyDown={onKeyDown}
        className="no-scrollbar -mx-1 flex min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-line bg-surface/80 p-1.5 shadow-card backdrop-blur-xl"
      >
        {commodities.map((c) => {
          const active = c === selected;
          const tint = produceMeta(c).tint;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={c}
              title={c}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelectedCommodity(c)}
              className={cx(
                'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow,transform] duration-300 ease-spring',
                active ? 'bg-surface' : 'hover:bg-well'
              )}
              style={active ? { boxShadow: `0 0 0 2px ${tint}, 0 8px 22px -6px ${tintAlpha(tint, 0.65)}` } : undefined}
            >
              <ProduceIcon commodity={c} size={active ? 34 : 30} bubble={active} animated={active} decorative />
            </button>
          );
        })}
      </div>
      <div className="hidden shrink-0 items-center gap-1 text-[11.5px] text-faint 2xl:flex" aria-hidden="true">
        <Kbd>J</Kbd>
        <Kbd>K</Kbd>
      </div>
    </div>
  );
}

export const ProduceSwitcher = memo(ProduceSwitcherBase);
export default ProduceSwitcher;

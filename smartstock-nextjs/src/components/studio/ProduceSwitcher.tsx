'use client';

// Produce as symbols, not names: a row of tinted bubbles. The name lives in the tooltip and aria-label.
// Selecting one updates the shared CommodityContext, so the rest of the app follows.

import { memo } from 'react';
import { ProduceIcon, produceMeta } from '@/components/produce/ProduceIcon';
import { cx } from './format';
import { FOCUS } from './primitives';
import { useRadioGroup } from './useRadioGroup';

interface ProduceSwitcherProps {
  commodities: string[];
  selected: string;
  onSelect: (commodity: string) => void;
}

function ProduceSwitcher({ commodities, selected, onSelect }: ProduceSwitcherProps) {
  const index = commodities.indexOf(selected);
  const radio = useRadioGroup(commodities.length, index, (i) => onSelect(commodities[i]));

  return (
    <div role="radiogroup" aria-label="Produce" className="flex flex-wrap gap-2">
      {commodities.map((c, i) => {
        const meta = produceMeta(c);
        const active = c === selected;
        return (
          <button
            key={c}
            ref={radio.setRef(i)}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={c}
            title={c}
            tabIndex={radio.tabIndexFor(i)}
            onKeyDown={(e) => radio.onKeyDown(e, i)}
            onClick={() => onSelect(c)}
            className={cx(
              'group relative grid h-11 w-11 place-items-center rounded-full border transition-[transform,background-color,border-color,box-shadow] duration-300 ease-spring hover:scale-[1.08]',
              active ? 'scale-[1.06] border-transparent bg-surface' : 'border-line bg-surface/70 hover:bg-surface',
              FOCUS,
            )}
            style={active ? { boxShadow: `0 0 0 2px ${meta.tint}, 0 10px 22px -12px ${meta.tint}` } : undefined}
          >
            <ProduceIcon commodity={c} size={34} bubble animated={active} title={c} />
          </button>
        );
      })}
    </div>
  );
}

export default memo(ProduceSwitcher);

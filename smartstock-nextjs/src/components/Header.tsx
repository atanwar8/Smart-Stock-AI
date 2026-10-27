'use client';

import { useEffect, useRef, useState } from 'react';
import { Menu, Plus, Search } from 'lucide-react';
import { useCommodity } from '@/contexts/CommodityContext';
import { goToTab } from '@/lib/tabs';
import { BackendStatus } from '@/lib/useBackendStatus';
import { Button, ProduceTile, cx } from './ui';

interface HeaderProps {
  status: BackendStatus;
  onOpenMenu: () => void;
}

const STATUS = {
  online: { dot: 'bg-[#2f9a5a]', label: 'Live' },
  checking: { dot: 'bg-[#d99a1e] animate-pulse', label: 'Waking up' },
  offline: { dot: 'bg-[#dd5a43]', label: 'Offline' },
};

export default function Header({ status, onOpenMenu }: HeaderProps) {
  const { commodities, selectedCommodity, setSelectedCommodity } = useCommodity();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = commodities.filter((c) => c.toLowerCase().includes(query.trim().toLowerCase()));

  // ⌘K / Ctrl+K focuses produce search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const choose = (commodity: string) => {
    setSelectedCommodity(commodity);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const s = STATUS[status.state];

  return (
    <header className="relative z-20 mb-5 flex items-center gap-2 pb-2 pt-3 sm:gap-3">
      <button
        onClick={onOpenMenu}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-2 bg-surface text-ink lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-[18px] w-[18px]" />
      </button>

      {/* Produce search: picks the commodity every chart follows */}
      <div className="relative w-full max-w-[420px]">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls="produce-results"
          aria-label="Search produce"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setHighlight((h) => Math.min(h + 1, matches.length - 1));
            if (e.key === 'ArrowUp') setHighlight((h) => Math.max(h - 1, 0));
            if (e.key === 'Enter' && matches[highlight]) choose(matches[highlight]);
            if (e.key === 'Escape') inputRef.current?.blur();
          }}
          placeholder={`Search produce · showing ${selectedCommodity}`}
          className="h-11 w-full rounded-full border border-line/70 bg-surface/90 pl-10 pr-14 text-[14px] text-ink shadow-[0_1px_2px_rgb(20_34_30/0.05)] placeholder:text-faint focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line-2 bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-faint sm:block">
          ⌘K
        </kbd>
        {open && (
          <ul
            id="produce-results"
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-80 overflow-y-auto rounded-[16px] border border-line/70 bg-surface p-1.5 shadow-pop"
          >
            {matches.length === 0 && <li className="px-3 py-2.5 text-[13px] text-muted">No produce matches “{query}”</li>}
            {matches.map((c, i) => (
              <li
                key={c}
                role="option"
                aria-selected={c === selectedCommodity}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
                onMouseEnter={() => setHighlight(i)}
                className={cx('flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13.5px]', i === highlight && 'bg-well')}
              >
                <ProduceTile name={c} size="sm" />
                <span className="flex-1 font-semibold text-ink">{c}</span>
                {c === selectedCommodity && <span className="text-[12px] text-faint">Selected</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden h-10 items-center gap-2 rounded-full border border-line/70 bg-surface px-3.5 text-[13px] font-semibold text-ink sm:inline-flex" title="Forecasting API status">
          <span className={cx('h-2 w-2 rounded-full', s.dot)} />
          {s.label}
        </span>
        <Button variant="primary" icon={Plus} onClick={() => goToTab('ordering')}>
          <span className="hidden sm:inline">Log stock</span>
        </Button>
      </div>
    </header>
  );
}

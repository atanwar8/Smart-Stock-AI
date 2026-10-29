'use client';

import { memo } from 'react';
import { CalendarDays } from 'lucide-react';
import { useToday } from '@/lib/hooks';
import type { BackendStatus } from '@/lib/useBackendStatus';
import { cx } from '../ui';
import { BrandMark } from './Rail';
import ProduceSwitcher from './ProduceSwitcher';

interface TopBarProps {
  status: BackendStatus;
  commodities: string[];
  selected: string;
}

const STATUS = {
  online: { dot: 'bg-[#34a865]', label: 'Live' },
  checking: { dot: 'bg-[#d99a1e] animate-pulse', label: 'Waking up' },
  offline: { dot: 'bg-[#dd5a43]', label: 'Offline' },
};

function TopBarBase({ status, commodities, selected }: TopBarProps) {
  const s = STATUS[status.state];
  const health = status.health;
  const today = useToday();

  return (
    <header className="relative z-20 flex flex-col gap-3 pb-6 pt-4 sm:pt-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-2">
        {/* The rail holds the mark on desktop; phones get it here */}
        <a href="#/overview" aria-label="SmartStock AI, overview" className="mr-1 rounded-[12px] lg:hidden">
          <BrandMark size={34} />
        </a>
        <span className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface/80 px-3.5 text-[12.5px] font-semibold text-ink shadow-card backdrop-blur-xl">
          <CalendarDays className="h-3.5 w-3.5 text-faint" />
          {today ? (
            <time dateTime={today.toISOString().slice(0, 10)}>{today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</time>
          ) : (
            <span className="shimmer h-3 w-28 rounded-full" />
          )}
        </span>
        <span
          role="status"
          title={status.state === 'online' && health ? `${health.models_trained} of ${health.viable_commodities} models trained` : 'Forecasting API status'}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface/80 px-3.5 text-[12.5px] font-semibold text-ink shadow-card backdrop-blur-xl"
        >
          <span className={cx('h-2 w-2 rounded-full', s.dot)} />
          {s.label}
          {status.state === 'online' && health && (
            <span className="tabular hidden font-mono text-[11px] font-medium text-faint sm:inline">
              {health.models_trained}/{health.viable_commodities} models
            </span>
          )}
        </span>
      </div>
      <ProduceSwitcher commodities={commodities} selected={selected} />
    </header>
  );
}

export const TopBar = memo(TopBarBase);
export default TopBar;

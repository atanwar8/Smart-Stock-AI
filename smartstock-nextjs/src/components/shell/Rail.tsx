'use client';

import { memo } from 'react';
import { BookOpen } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { TABS, type TabId } from '@/lib/tabs';
import type { BackendStatus } from '@/lib/useBackendStatus';
import { cx } from '../ui';

export type Badges = Partial<Record<TabId, { count: number; tone: 'alert' | 'notice' }>>;

interface RailProps {
  activeTab: TabId;
  badges: Badges;
  status: BackendStatus;
}

const STATUS_DOT = {
  online: 'bg-[#34a865]',
  checking: 'bg-[#d99a1e] animate-pulse',
  offline: 'bg-[#dd5a43]',
};

/** The app's mark: a leaf for real prices and an iris seed for the forecast */
export function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-[12px] bg-night shadow-[0_6px_16px_-6px_rgb(15_24_35/0.6)]" style={{ width: size, height: size }}>
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 19c0-8 5.5-13.5 14-14-.4 8.6-6 14-14 14z" fill="#7ee2b8" />
        <path d="M5 19c3.2-3.4 6.4-6.2 10-8.6" stroke="#0f1823" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <circle cx="18" cy="18" r="2.6" fill="#a5a6ff" />
      </svg>
    </span>
  );
}

function Badge({ badge, compact }: { badge?: { count: number; tone: 'alert' | 'notice' }; compact?: boolean }) {
  if (!badge || badge.count <= 0) return null;
  return (
    <span
      className={cx(
        'tabular absolute flex items-center justify-center rounded-full font-mono font-semibold ring-2 ring-surface',
        compact ? 'right-[calc(50%-20px)] top-1 h-4 min-w-4 px-1 text-[9.5px]' : '-right-1 -top-1 h-[18px] min-w-[18px] px-1 text-[10px]',
        badge.tone === 'alert' ? 'bg-[#dd5a43] text-white' : 'bg-[#f2c35b] text-[#3b2a05]'
      )}
    >
      {badge.count}
    </span>
  );
}

// Floating icon rail on desktop, a frosted dock along the bottom on phones
function RailBase({ activeTab, badges, status }: RailProps) {
  const health = status.health;
  const statusLabel =
    status.state === 'offline' ? 'Forecasting API offline' : status.state === 'checking' ? 'Waking the forecasting API' : `Live, ${health?.models_trained ?? 0} of ${health?.viable_commodities ?? 0} models trained`;

  return (
    <>
      <nav
        aria-label="Sections"
        className="fixed bottom-4 left-4 top-4 z-40 hidden w-[68px] flex-col items-center rounded-[26px] border border-line bg-surface/80 py-4 shadow-card backdrop-blur-xl lg:flex"
      >
        <a href="#/overview" aria-label="SmartStock AI, overview" className="mb-6 rounded-[12px]">
          <BrandMark />
        </a>
        <ul className="flex flex-1 flex-col items-center gap-1.5">
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            const Icon = tab.icon;
            return (
              <li key={tab.id} className="group relative">
                <a
                  href={`#/${tab.id}`}
                  aria-current={active ? 'page' : undefined}
                  aria-label={tab.label}
                  aria-keyshortcuts={tab.hotkey}
                  className={cx(
                    'relative flex h-11 w-11 items-center justify-center rounded-[14px] transition-[background-color,color,transform] duration-300 ease-spring active:scale-95',
                    active ? 'bg-ink text-white shadow-[0_8px_18px_-8px_rgb(28_33_30/0.7)]' : 'text-muted hover:bg-well hover:text-ink'
                  )}
                >
                  <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.1 : 1.8} />
                  <Badge badge={badges[tab.id]} />
                </a>
                {/* Hover label, like a macOS dock tooltip */}
                <span className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-50 flex -translate-y-1/2 translate-x-[-4px] items-center gap-2 whitespace-nowrap rounded-[10px] bg-ink px-2.5 py-1.5 text-[12.5px] font-semibold text-white opacity-0 shadow-pop transition-[opacity,transform] duration-200 group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:translate-x-0 group-hover:opacity-100">
                  {tab.label}
                  <span className="rounded-[5px] bg-white/15 px-1.5 font-mono text-[10.5px] font-medium">{tab.hotkey}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col items-center gap-3">
          <a
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noreferrer"
            aria-label="API docs (opens in a new tab)"
            title="API docs"
            className="flex h-10 w-10 items-center justify-center rounded-[13px] text-muted hover:bg-well hover:text-ink"
          >
            <BookOpen className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </a>
          <span className="flex h-6 w-6 items-center justify-center" role="status" aria-label={statusLabel} title={statusLabel}>
            <span className={cx('h-2.5 w-2.5 rounded-full ring-4 ring-surface', STATUS_DOT[status.state])} />
          </span>
        </div>
      </nav>

      <nav
        aria-label="Sections"
        className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 mx-auto flex h-[62px] max-w-[440px] items-stretch justify-around rounded-[22px] border border-line bg-surface/85 px-1.5 shadow-pop backdrop-blur-xl lg:hidden"
      >
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          const Icon = tab.icon;
          return (
            <a
              key={tab.id}
              href={`#/${tab.id}`}
              aria-current={active ? 'page' : undefined}
              className={cx('relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[16px] transition-colors', active ? 'text-ink' : 'text-muted')}
            >
              <span className={cx('flex h-8 w-12 items-center justify-center rounded-full transition-[background-color] duration-300', active && 'bg-well')}>
                <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.1 : 1.8} />
              </span>
              <span className="max-w-full truncate px-0.5 text-[10px] font-semibold">{tab.short}</span>
              <Badge badge={badges[tab.id]} compact />
            </a>
          );
        })}
      </nav>
    </>
  );
}

export const Rail = memo(RailBase);
export default Rail;

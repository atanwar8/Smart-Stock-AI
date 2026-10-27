'use client';

import { BookOpen, PanelLeftClose, PanelLeftOpen, Sprout, X } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { TABS, TabId } from '@/lib/tabs';
import { BackendStatus } from '@/lib/useBackendStatus';
import { cx } from './ui';

interface SidebarProps {
  activeTab: TabId;
  collapsed: boolean;
  mobileOpen: boolean;
  status: BackendStatus;
  badges: Partial<Record<TabId, { count: number; tone: 'alert' | 'notice' }>>;
  onTabChange: (tabId: TabId) => void;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
}

const GROUPS = ['Today', 'Plan', 'Monitor'] as const;

export default function Sidebar({ activeTab, collapsed: collapsedPref, mobileOpen, status, badges, onTabChange, onToggleCollapsed, onCloseMobile }: SidebarProps) {
  const collapsed = collapsedPref && !mobileOpen;
  const health = status.health;
  const trained = health?.models_trained ?? 0;
  const total = health?.viable_commodities ?? 0;

  return (
    <>
      <div
        className={cx('fixed inset-0 z-30 bg-ink/40 backdrop-blur-[2px] transition-opacity lg:hidden', mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      <aside
        aria-label="Main navigation"
        className={cx(
          'fixed inset-y-3 left-3 z-40 flex flex-col rounded-[26px] bg-side text-side-ink shadow-side transition-[width,transform] duration-300 ease-out-soft',
          'lg:sticky lg:top-3 lg:h-[calc(100dvh-24px)] lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-[110%]',
          collapsed ? 'w-[76px]' : 'w-[256px]'
        )}
      >
        {/* Brand */}
        <div className={cx('flex items-center gap-3 px-4 pb-2 pt-4', collapsed && 'flex-col px-2')}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-harvest text-harvest-ink">
            <Sprout className="h-5 w-5" strokeWidth={2.25} />
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[16px] font-semibold text-white">SmartStock AI</div>
              <div className="text-[12px] text-side-ink/60">Produce desk</div>
            </div>
          )}
          <button
            onClick={mobileOpen ? onCloseMobile : onToggleCollapsed}
            className="flex h-8 w-8 items-center justify-center rounded-[10px] text-side-ink/60 ring-1 ring-white/10 hover:bg-white/5 hover:text-white"
            aria-label={mobileOpen ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {GROUPS.map((group) => (
            <div key={group} className="mt-4">
              {collapsed ? (
                <div className="mx-auto mb-2 h-px w-6 bg-white/10" />
              ) : (
                <div className="mb-1.5 px-3 text-[12px] font-semibold text-side-ink/45">{group}</div>
              )}
              <ul className="space-y-0.5">
                {TABS.filter((t) => t.group === group).map((tab) => {
                  const active = tab.id === activeTab;
                  const badge = badges[tab.id];
                  const Icon = tab.icon;
                  return (
                    <li key={tab.id}>
                      <button
                        onClick={() => onTabChange(tab.id)}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? tab.label : undefined}
                        className={cx(
                          'relative flex h-10 w-full items-center rounded-[12px] text-[14px] font-semibold transition-colors',
                          collapsed ? 'justify-center' : 'gap-3 px-3',
                          active ? 'bg-harvest text-harvest-ink' : 'text-side-ink/80 hover:bg-white/[0.06] hover:text-white'
                        )}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.25 : 1.9} />
                        {!collapsed && <span className="flex-1 text-left">{tab.label}</span>}
                        {badge && badge.count > 0 && (
                          <span
                            className={cx(
                              'tabular flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
                              collapsed && 'absolute right-1.5 top-1 h-4 min-w-4 text-[10px]',
                              badge.tone === 'alert' ? 'bg-[#dd5a43] text-white' : active ? 'bg-harvest-ink/15 text-harvest-ink' : 'bg-white/10 text-side-ink'
                            )}
                          >
                            {badge.count}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <div className="mt-4">
            {collapsed ? <div className="mx-auto mb-2 h-px w-6 bg-white/10" /> : <div className="mb-1.5 px-3 text-[12px] font-semibold text-side-ink/45">Developers</div>}
            <a
              href={`${API_BASE}/docs`}
              target="_blank"
              rel="noreferrer"
              title={collapsed ? 'API docs' : undefined}
              className={cx(
                'flex h-10 items-center rounded-[12px] text-[14px] font-semibold text-side-ink/80 hover:bg-white/[0.06] hover:text-white',
                collapsed ? 'justify-center' : 'gap-3 px-3'
              )}
            >
              <BookOpen className="h-[18px] w-[18px]" strokeWidth={1.9} />
              {!collapsed && 'API docs'}
            </a>
          </div>
        </nav>

        {/* Model status */}
        <div className="p-3">
          {collapsed ? (
            <div className="flex justify-center py-2" title={status.state === 'online' ? `${trained} of ${total} models trained` : 'API offline'}>
              <span className={cx('h-2.5 w-2.5 rounded-full', status.state === 'online' ? 'bg-[#2f9a5a]' : status.state === 'checking' ? 'animate-pulse bg-harvest' : 'bg-[#dd5a43]')} />
            </div>
          ) : (
            <div className="rounded-[16px] bg-white/[0.05] p-3.5 ring-1 ring-white/[0.06]">
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="font-semibold text-white">
                  {status.state === 'offline' ? 'API offline' : status.state === 'checking' ? 'Waking the API…' : `${trained} models trained`}
                </span>
                {status.state === 'online' && <span className="tabular text-[12px] text-side-ink/55">of {total}</span>}
              </div>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={cx('h-full rounded-full transition-[width] duration-700', status.state === 'offline' ? 'bg-[#dd5a43]' : 'bg-[#2f9a5a]')}
                  style={{ width: status.state === 'offline' ? '100%' : `${total ? Math.max(4, (trained / total) * 100) : 4}%` }}
                />
              </div>
              <p className="mt-2 text-[12px] text-side-ink/55">
                {status.state === 'offline'
                  ? 'Retrying every 30 seconds'
                  : trained < total
                  ? 'Models train the first time a commodity is opened'
                  : 'Every commodity has a trained model'}
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

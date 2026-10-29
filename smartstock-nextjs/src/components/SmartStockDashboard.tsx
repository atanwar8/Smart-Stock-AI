'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PlugZap } from 'lucide-react';
import { CommodityProvider, useCommodityActions, useCommodityState } from '../contexts/CommodityContext';
import { useApi } from '@/lib/api';
import { MUTED_EVENT, isMuted, readMuted, type MutedAlerts } from '@/lib/alertPrefs';
import { isTypingTarget } from '@/lib/hooks';
import { TabId, isTabId, TABS, goToTab } from '@/lib/tabs';
import type { AlertItem, InventoryRow } from '@/lib/types';
import { useBackendStatus } from '@/lib/useBackendStatus';
import Rail, { type Badges } from './shell/Rail';
import TopBar from './shell/TopBar';
import PageSkeleton from './shell/PageSkeleton';

// Each section is its own chunk: opening the app only downloads the overview. Sections render in the
// browser only (they read the visitor's clock and live API data), so the static HTML ships their skeleton.
const DashboardTab = dynamic(() => import('./DashboardTab'), { ssr: false, loading: () => <PageSkeleton variant="overview" /> });
const OrderingTab = dynamic(() => import('./OrderingTab'), { ssr: false, loading: () => <PageSkeleton /> });
const PredictionsTab = dynamic(() => import('./PredictionsTab'), { ssr: false, loading: () => <PageSkeleton /> });
const AlertsTab = dynamic(() => import('./AlertsTab'), { ssr: false, loading: () => <PageSkeleton /> });
const ScrapeTab = dynamic(() => import('./ScrapeTab'), { ssr: false, loading: () => <PageSkeleton /> });

const tabFromHash = (): TabId => {
  const id = window.location.hash.replace(/^#\/?/, '');
  return isTabId(id) ? id : 'overview';
};

export default function SmartStockDashboard() {
  return (
    <CommodityProvider>
      <Shell />
    </CommodityProvider>
  );
}

function Shell() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const status = useBackendStatus();
  const { commodities, selectedCommodity } = useCommodityState();
  const { setSelectedCommodity } = useCommodityActions();

  // Rail badges: alerts waiting, and stock that needs ordering
  const alerts = useApi<{ alerts: AlertItem[] }>('/alerts/recent');
  const inventory = useApi<{ inventory: InventoryRow[] }>('/inventory/list');
  const { reload: reloadAlerts } = alerts;
  const { reload: reloadInventory } = inventory;

  const [muted, setMuted] = useState<MutedAlerts>({});
  useEffect(() => {
    const sync = () => setMuted(readMuted());
    sync();
    window.addEventListener(MUTED_EVENT, sync);
    return () => window.removeEventListener(MUTED_EVENT, sync);
  }, []);

  // The URL hash is the source of truth for the section, so sections can be linked and survive a reload
  useEffect(() => {
    const sync = () => setActiveTab(tabFromHash());
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    const label = TABS.find((t) => t.id === activeTab)?.label;
    document.title = `${label} · SmartStock AI`;
    window.scrollTo({ top: 0 });
    reloadAlerts();
    reloadInventory();
  }, [activeTab, reloadAlerts, reloadInventory]);

  // Keyboard: 1-5 open sections, J/K move along the produce shelf (the Alerts page uses J/K for its list)
  const keyState = useRef({ activeTab, commodities, selectedCommodity });
  useEffect(() => {
    keyState.current = { activeTab, commodities, selectedCommodity };
  }, [activeTab, commodities, selectedCommodity]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      const tab = TABS.find((t) => t.hotkey === e.key);
      if (tab) {
        goToTab(tab.id);
        return;
      }
      const key = e.key.toLowerCase();
      const { activeTab: current, commodities: list, selectedCommodity: selected } = keyState.current;
      if ((key === 'j' || key === 'k') && current !== 'alerts' && list.length) {
        e.preventDefault();
        const i = Math.max(0, list.indexOf(selected));
        setSelectedCommodity(list[(i + (key === 'j' ? 1 : list.length - 1)) % list.length]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelectedCommodity]);

  const badges = useMemo<Badges>(() => {
    const urgentAlerts = alerts.data?.alerts.filter((a) => (a.type === 'critical' || a.type === 'warning') && !isMuted(muted, a.id)).length ?? 0;
    const lowStock = inventory.data?.inventory.filter((i) => i.status_color === 'red' || i.status_color === 'yellow').length ?? 0;
    return { ordering: { count: lowStock, tone: 'notice' }, alerts: { count: urgentAlerts, tone: 'alert' } };
  }, [alerts.data, inventory.data, muted]);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <Rail activeTab={activeTab} badges={badges} status={status} />

      <main id="main" className="min-w-0 px-4 pb-32 sm:px-6 lg:pb-12 lg:pl-[112px] lg:pr-8">
        <div className="mx-auto max-w-[1320px]">
          <TopBar status={status} commodities={commodities} selected={selectedCommodity} />

          {status.state === 'offline' && (
            <div role="alert" className="mb-6 flex items-start gap-3 rounded-[18px] border border-[#d99a1e]/30 bg-[#fdf6e7] px-4 py-3 text-[13.5px] text-warn">
              <PlugZap className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <b className="font-semibold">The forecasting API isn&apos;t answering.</b> Numbers below may be missing until it&apos;s back. Running locally? Start
                everything with <code className="rounded bg-white/70 px-1 font-mono text-[12px]">./start.sh</code>.
              </p>
            </div>
          )}

          <div key={activeTab} className="page-enter">
            {activeTab === 'overview' && <DashboardTab />}
            {activeTab === 'ordering' && <OrderingTab onInventoryChange={reloadInventory} />}
            {activeTab === 'predictions' && <PredictionsTab />}
            {activeTab === 'alerts' && <AlertsTab />}
            {activeTab === 'refresh' && <ScrapeTab health={status.health} />}
          </div>
        </div>
      </main>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { PlugZap } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import DashboardTab from './DashboardTab';
import OrderingTab from './OrderingTab';
import PredictionsTab from './PredictionsTab';
import AlertsTab from './AlertsTab';
import ScrapeTab from './ScrapeTab';
import { CommodityProvider } from '../contexts/CommodityContext';
import { useApi } from '@/lib/api';
import { TabId, isTabId, TABS } from '@/lib/tabs';
import type { AlertItem, InventoryRow } from '@/lib/types';
import { useBackendStatus } from '@/lib/useBackendStatus';

const tabFromHash = (): TabId => {
  const id = window.location.hash.replace(/^#\/?/, '');
  return isTabId(id) ? id : 'overview';
};

export default function SmartStockDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const status = useBackendStatus();

  // Sidebar badges: alerts waiting, and stock that needs ordering
  const alerts = useApi<{ alerts: AlertItem[] }>('/alerts/recent');
  const inventory = useApi<{ inventory: InventoryRow[] }>('/inventory/list');
  const { reload: reloadAlerts } = alerts;
  const { reload: reloadInventory } = inventory;

  // The URL hash is the source of truth for the section, so sections can be linked and survive a reload
  useEffect(() => {
    const sync = () => {
      setActiveTab(tabFromHash());
      setMobileOpen(false);
    };
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

  const urgentAlerts = alerts.data?.alerts.filter((a) => a.type === 'critical' || a.type === 'warning').length ?? 0;
  const lowStock = inventory.data?.inventory.filter((i) => i.status_color === 'red' || i.status_color === 'yellow').length ?? 0;

  return (
    <CommodityProvider>
      <div className="flex min-h-dvh gap-3 lg:gap-6 lg:p-3">
        <Sidebar
          activeTab={activeTab}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          status={status}
          badges={{
            ordering: { count: lowStock, tone: 'notice' },
            alerts: { count: urgentAlerts, tone: 'alert' },
          }}
          onTabChange={(id) => (window.location.hash = `/${id}`)}
          onToggleCollapsed={() => setCollapsed(!collapsed)}
          onCloseMobile={() => setMobileOpen(false)}
        />

        <main className="min-w-0 flex-1 px-4 pb-10 sm:px-6 lg:px-2 lg:pr-4">
          <div className="mx-auto max-w-[1360px]">
            <Header status={status} onOpenMenu={() => setMobileOpen(true)} />

            {status.state === 'offline' && (
              <div className="mb-5 flex items-start gap-3 rounded-[16px] border border-[#d99a1e]/30 bg-[#d99a1e]/10 px-4 py-3 text-[13.5px] text-warn">
                <PlugZap className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  <b className="font-semibold">The forecasting API isn&apos;t answering.</b> Numbers below may be missing until it&apos;s back. Running locally? Start
                  everything with <code className="rounded bg-white/60 px-1">./start.sh</code>.
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
    </CommodityProvider>
  );
}

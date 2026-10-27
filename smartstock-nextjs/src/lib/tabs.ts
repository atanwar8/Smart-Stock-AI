import { Activity, Bell, DatabaseZap, LineChart, ShoppingBasket, type LucideIcon } from 'lucide-react';

export type TabId = 'overview' | 'ordering' | 'predictions' | 'alerts' | 'refresh';

export interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
  group: 'Today' | 'Plan' | 'Monitor';
}

export const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: Activity, group: 'Today' },
  { id: 'ordering', label: 'Smart ordering', icon: ShoppingBasket, group: 'Plan' },
  { id: 'predictions', label: 'Predictions', icon: LineChart, group: 'Plan' },
  { id: 'alerts', label: 'Alerts', icon: Bell, group: 'Monitor' },
  { id: 'refresh', label: 'Data refresh', icon: DatabaseZap, group: 'Monitor' },
];

export const isTabId = (value: string): value is TabId => TABS.some((t) => t.id === value);

// Lets any tab jump to another, e.g. "Order" on the overview opens Smart ordering
export const goToTab = (tab: TabId) => {
  window.location.hash = `/${tab}`;
};

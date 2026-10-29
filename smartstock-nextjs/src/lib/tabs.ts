import { Bell, CalendarDays, DatabaseZap, LayoutGrid, Sparkles, type LucideIcon } from 'lucide-react';

export type TabId = 'overview' | 'ordering' | 'predictions' | 'alerts' | 'refresh';

export interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
  group: 'Today' | 'Plan' | 'Monitor';
  /** One-word label for the phone dock */
  short: string;
  /** Number key that opens the section */
  hotkey: string;
}

export const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'Today', short: 'Today', hotkey: '1' },
  { id: 'ordering', label: 'Smart ordering', icon: CalendarDays, group: 'Plan', short: 'Order', hotkey: '2' },
  { id: 'predictions', label: 'Forecast studio', icon: Sparkles, group: 'Plan', short: 'Forecast', hotkey: '3' },
  { id: 'alerts', label: 'Alerts', icon: Bell, group: 'Monitor', short: 'Alerts', hotkey: '4' },
  { id: 'refresh', label: 'Data refresh', icon: DatabaseZap, group: 'Monitor', short: 'Refresh', hotkey: '5' },
];

export const isTabId = (value: string): value is TabId => TABS.some((t) => t.id === value);

// Lets any tab jump to another, e.g. "Order" on the overview opens Smart ordering
export const goToTab = (tab: TabId) => {
  window.location.hash = `/${tab}`;
};

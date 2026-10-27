'use client';

import { useEffect, useState } from 'react';
import { AlertOctagon, BellOff, CheckCircle2, Info, RefreshCw, Server, TrendingUp, type LucideIcon } from 'lucide-react';
import { postJSON, useApi } from '@/lib/api';
import type { AlertItem, AlertSettings } from '@/lib/types';
import { Button, Card, CardHeader, Empty, ErrorNote, Field, PageHeader, Pill, Segmented, Skeleton, Switch, cx } from './ui';

type Filter = 'all' | 'stock' | 'price' | 'system';

const KIND: Record<string, { icon: LucideIcon; tile: string; filter: Filter }> = {
  critical: { icon: AlertOctagon, tile: 'bg-bad/10 text-bad', filter: 'stock' },
  warning: { icon: TrendingUp, tile: 'bg-[#d99a1e]/15 text-warn', filter: 'price' },
  info: { icon: Info, tile: 'bg-info/10 text-info', filter: 'price' },
  success: { icon: CheckCircle2, tile: 'bg-good/10 text-good', filter: 'stock' },
  system: { icon: Server, tile: 'bg-well text-muted', filter: 'system' },
};

const kindOf = (a: AlertItem) => {
  const k = KIND[a.type] ?? KIND.system;
  // Spoilage warnings are stock alerts even though they're typed "warning"
  if (a.type === 'warning' && !a.title.toLowerCase().includes('price')) return { ...k, filter: 'stock' as Filter };
  return k;
};

const DEFAULTS: AlertSettings = {
  low_stock_threshold: 1,
  price_change_alert: 1,
  spoilage_warning: 1,
  email_notifications: true,
  sms_notifications: true,
  push_notifications: false,
  alert_frequency: 'immediate',
};

export default function AlertsTab() {
  const recent = useApi<{ alerts: AlertItem[] }>('/alerts/recent');
  const saved = useApi<AlertSettings>('/alerts/settings');
  const [filter, setFilter] = useState<Filter>('all');

  const [settings, setSettings] = useState<AlertSettings>(DEFAULTS);
  useEffect(() => {
    if (saved.data) setSettings(saved.data);
  }, [saved.data]);

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = saved.data ? JSON.stringify(saved.data) !== JSON.stringify(settings) : false;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      await postJSON('/alerts/settings', settings);
      setResult({ ok: true, text: 'Alert rules saved.' });
      saved.reload();
      recent.reload();
    } catch (err) {
      setResult({ ok: false, text: `Couldn't save: ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof AlertSettings>(key: K, value: AlertSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setResult(null);
  };

  const alerts = recent.data?.alerts ?? [];
  const shown = filter === 'all' ? alerts : alerts.filter((a) => kindOf(a).filter === filter);
  const urgent = alerts.filter((a) => a.type === 'critical').length;

  return (
    <>
      <PageHeader
        crumb={<>Monitor <span className="mx-1.5">›</span> Alerts</>}
        title="Alerts"
        summary={
          recent.data ? (
            <>
              <b>{alerts.length} alerts</b> recently{urgent > 0 && <>, <b>{urgent} critical</b></>}. The rules on the right decide what reaches you and how often.
            </>
          ) : (
            'Stock, spoilage and price-change notifications.'
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent alerts"
            subtitle="Newest first."
            action={
              <Button variant="ghost" icon={RefreshCw} className="h-8 px-3" onClick={recent.reload} loading={recent.loading && !!recent.data}>
                Refresh
              </Button>
            }
          />
          <div className="px-5 pb-3">
            <Segmented
              label="Filter alerts"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All ${alerts.length}` },
                { value: 'stock', label: 'Stock' },
                { value: 'price', label: 'Price' },
                { value: 'system', label: 'System' },
              ]}
            />
          </div>
          <div className="px-3 pb-3">
            {recent.error ? (
              <div className="px-2">
                <ErrorNote>Couldn&apos;t load alerts: {recent.error}</ErrorNote>
              </div>
            ) : !recent.data ? (
              <div className="space-y-2 px-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : shown.length === 0 ? (
              <Empty icon={BellOff} title={filter === 'all' ? 'No alerts' : `No ${filter} alerts`} body="When stock runs low or prices move past your thresholds, it shows up here." />
            ) : (
              <ul>
                {shown.map((a) => {
                  const k = kindOf(a);
                  const Icon = k.icon;
                  return (
                    <li key={a.id} className="flex items-start gap-3 rounded-tile px-2 py-3 hover:bg-surface-2 [&+&]:border-t [&+&]:border-line">
                      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', k.tile)}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold">{a.title}</span>
                          {a.type === 'critical' && <Pill tone="bad">Critical</Pill>}
                        </div>
                        <p className="mt-0.5 text-[13px] text-muted">{a.message}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[12px] text-faint">{a.timestamp}</div>
                        {a.commodity && <div className="mt-1 text-[12px] font-semibold text-muted">{a.commodity}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Alert rules" subtitle="Thresholds and where alerts go." />
          <form onSubmit={save} className="px-5 pb-5">
            <div className="space-y-4">
              <Field
                label="Low stock"
                type="number"
                min={0}
                step={1}
                suffix="days of cover"
                hint="Alert when an item will run out within this many days."
                value={settings.low_stock_threshold}
                onChange={(e) => set('low_stock_threshold', Number(e.target.value))}
              />
              <Field
                label="Price move"
                type="number"
                min={0}
                step={0.5}
                suffix="%"
                hint="Alert when a forecast moves at least this much."
                value={settings.price_change_alert}
                onChange={(e) => set('price_change_alert', Number(e.target.value))}
              />
              <Field
                label="Spoilage"
                type="number"
                min={0}
                step={1}
                suffix="days before"
                hint="Warn this many days before stock passes its shelf life."
                value={settings.spoilage_warning}
                onChange={(e) => set('spoilage_warning', Number(e.target.value))}
              />
            </div>

            <div className="mt-5 border-t border-line pt-2">
              <Switch label="Email" description="Daily summaries and critical alerts" checked={settings.email_notifications} onChange={(v) => set('email_notifications', v)} />
              <Switch label="Text message" description="Critical alerts only" checked={settings.sms_notifications} onChange={(v) => set('sms_notifications', v)} />
              <Switch label="Push" description="On this device" checked={settings.push_notifications} onChange={(v) => set('push_notifications', v)} />
            </div>

            <div className="mt-3 border-t border-line pt-4">
              <div className="mb-2 text-[12.5px] font-semibold">How often</div>
              <Segmented
                label="Alert frequency"
                value={settings.alert_frequency}
                onChange={(v) => set('alert_frequency', v)}
                options={[
                  { value: 'immediate', label: 'Right away' },
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                ]}
              />
            </div>

            {result && (
              <p className={cx('mt-4 flex items-center gap-2 text-[13px] font-semibold', result.ok ? 'text-good' : 'text-bad')}>
                {result.ok && <CheckCircle2 className="h-4 w-4" />}
                {result.text}
              </p>
            )}
            <Button type="submit" variant="primary" loading={saving} disabled={!dirty && !saving} className="mt-5 w-full">
              Save rules
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertOctagon, ArrowUpRight, BellOff, CheckCircle2, ChevronDown, EyeOff, RefreshCw, Server, TrendingDown, TrendingUp, Undo2, type LucideIcon } from 'lucide-react';
import { useCommodityActions, useCommodityState } from '../contexts/CommodityContext';
import { postJSON, qs, useApi } from '@/lib/api';
import { MUTED_EVENT, readMuted, writeMuted, isMuted, type MutedAlerts } from '@/lib/alertPrefs';
import { isTypingTarget } from '@/lib/hooks';
import { goToTab } from '@/lib/tabs';
import type { AlertItem, AlertSettings, TrendChart } from '@/lib/types';
import { usualBand, usualWeeklyMove } from '@/lib/usual';
import { verb } from '@/lib/words';
import { AreaLine, type RangePoint, type SeriesPoint } from './charts';
import ProduceIcon, { produceMeta } from './produce/ProduceIcon';
import { Button, Card, CardHeader, Empty, ErrorNote, Field, Kbd, PageHeader, Segmented, Skeleton, Switch, cx } from './ui';

type Filter = 'all' | 'stock' | 'price' | 'system';
type Kind = 'stock' | 'spoilage' | 'rising' | 'falling' | 'system';

const KIND: Record<Kind, { icon: LucideIcon; tile: string; filter: Filter; tag: string }> = {
  stock: { icon: AlertOctagon, tile: 'bg-bad/10 text-bad', filter: 'stock', tag: 'Running low' },
  spoilage: { icon: AlertOctagon, tile: 'bg-[#d99a1e]/15 text-warn', filter: 'stock', tag: 'Spoilage' },
  rising: { icon: TrendingUp, tile: 'bg-[#d99a1e]/15 text-warn', filter: 'price', tag: 'Price rising' },
  falling: { icon: TrendingDown, tile: 'bg-good/10 text-good', filter: 'price', tag: 'Buying window' },
  system: { icon: Server, tile: 'bg-well text-muted', filter: 'system', tag: 'Data' },
};

const kindOf = (a: AlertItem): Kind => {
  if (a.type === 'system') return 'system';
  if (a.id.startsWith('spoilage_') || /spoil/i.test(a.title)) return 'spoilage';
  if (a.id.startsWith('price_') || /price|opportunity/i.test(a.title)) return a.type === 'info' || /fall/i.test(a.message) ? 'falling' : 'rising';
  if (a.type === 'critical' || a.id.startsWith('stock_')) return 'stock';
  return a.type === 'info' || a.type === 'success' ? 'falling' : 'system';
};

// The one line under each alert that says why it fired, in terms of the chef's own rules
const why = (kind: Kind, s: AlertSettings) => {
  switch (kind) {
    case 'stock':
      return `Fewer days of cover than your low-stock rule (${s.low_stock_threshold} ${s.low_stock_threshold === 1 ? 'day' : 'days'}). Order before it runs out.`;
    case 'spoilage':
      return 'More on hand than you will use before it spoils. Use or sell the surplus first, and order less next time.';
    case 'rising':
      return `The forecast moves more than your ${s.price_change_alert}% price rule. Ordering sooner locks in today's price.`;
    case 'falling':
      return `Prices are forecast to fall more than ${s.price_change_alert}%. Waiting a few days could cost less.`;
    default:
      return 'Forecasts are only as fresh as the newest USDA report. Data refresh pulls the latest weeks.';
  }
};

const num = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1));

// The alert in one sentence, Atisbo-style: the fact plus how far it is from the chef's own rule
// ("forecast to rise 6.2% next week, 3.1x your 2% rule"). Falls back to the API's message.
const headline = (a: AlertItem, kind: Kind, s: AlertSettings): string => {
  if (!a.commodity) return `${a.message}.`;
  const label = produceMeta(a.commodity).label || a.commodity;
  const be = verb(label, 'are', 'is');
  if (kind === 'stock') {
    const m = a.message.match(/run out in ([\d.]+) days/);
    if (!m) return `${a.message}.`;
    const d = Number(m[1]);
    if (d < 0.05) return `${label} ${be} out of stock.`;
    const t = s.low_stock_threshold;
    const r = t > 0 ? d / t : 1;
    const share = r < 0.15 ? 'a fraction of' : r < 0.5 ? 'under half' : r < 0.95 ? `${Math.round(r * 100)}% of` : 'right at';
    return `${label} will run out in ${num(d)} ${d === 1 ? 'day' : 'days'}, ${share} the ${t}-day cover your rule asks for.`;
  }
  if (kind === 'spoilage') {
    const m = a.message.match(/lasts ([\d.]+) days but keeps about ([\d.]+)/);
    if (!m) return `${a.message}.`;
    const r = Number(m[1]) / Math.max(1, Number(m[2]));
    return r >= 1.05
      ? `${num(r)}× more ${label.toLowerCase()} on hand than will stay fresh.`
      : `${label} ${be} close to ${verb(label, 'their', 'its')} ${m[2]}-day shelf life.`;
  }
  if (kind === 'rising' || kind === 'falling') {
    const m = a.message.match(/(rise|fall) ([\d.]+)%/);
    if (!m) return `${a.message}.`;
    const p = Number(m[2]);
    const r = s.price_change_alert > 0 ? p / s.price_change_alert : 0;
    return `${label} ${be} forecast to ${m[1]} ${num(p)}% next week${r >= 1.2 ? `, ${num(r)}× your ${s.price_change_alert}% rule` : ''}.`;
  }
  return `${a.message}.`;
};

const PAGE = 8;

const DEFAULTS: AlertSettings = {
  low_stock_threshold: 1,
  price_change_alert: 1,
  spoilage_warning: 1,
  email_notifications: true,
  sms_notifications: true,
  push_notifications: false,
  alert_frequency: 'immediate',
};

const DAY = 24 * 60 * 60 * 1000;

export default function AlertsTab() {
  // Server-paged (most urgent first): "Show more" asks for a longer first page, so a refresh keeps
  // everything already on screen in one consistent request
  const [limit, setLimit] = useState(PAGE);
  const recent = useApi<{ alerts: AlertItem[]; total?: number }>(`/alerts/recent?limit=${limit}&offset=0`);
  const saved = useApi<AlertSettings>('/alerts/settings');
  const [filter, setFilter] = useState<Filter>('all');
  const [showHidden, setShowHidden] = useState(false);

  const [muted, setMuted] = useState<MutedAlerts>({});
  useEffect(() => {
    const sync = () => setMuted(readMuted());
    sync();
    window.addEventListener(MUTED_EVENT, sync);
    return () => window.removeEventListener(MUTED_EVENT, sync);
  }, []);
  const [lastMuted, setLastMuted] = useState<{ id: string; title: string } | null>(null);

  const mute = useCallback(
    (a: AlertItem, ms: number) => {
      writeMuted({ ...readMuted(), [a.id]: Date.now() + ms });
      setLastMuted({ id: a.id, title: ms === Infinity ? 'Marked not relevant' : 'Silenced for 24 hours' });
    },
    []
  );
  const restore = useCallback((id: string) => {
    const next = readMuted();
    delete next[id];
    writeMuted(next);
    setLastMuted(null);
  }, []);

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

  const alerts = useMemo(() => recent.data?.alerts ?? [], [recent.data]);
  const hiddenCount = alerts.filter((a) => isMuted(muted, a.id)).length;
  const shown = useMemo(
    () => alerts.filter((a) => (showHidden || !isMuted(muted, a.id)) && (filter === 'all' || KIND[kindOf(a)].filter === filter)),
    [alerts, muted, showHidden, filter]
  );
  const urgent = alerts.filter((a) => a.type === 'critical' && !isMuted(muted, a.id)).length;
  const total = recent.data?.total ?? alerts.length;
  const more = Math.max(0, total - alerts.length);
  const visible = total - hiddenCount;

  // J / K move through the list (the shell leaves J/K to this page), Enter opens the produce
  const [focus, setFocus] = useState(0);
  const focusRef = useRef(0);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  useEffect(() => setFocus((f) => Math.min(f, Math.max(0, shown.length - 1))), [shown.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        setFocus((f) => Math.max(0, Math.min(shown.length - 1, f + (k === 'j' ? 1 : -1))));
      } else if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest?.('button, a, [role="img"]') == null) {
        // Enter takes the focused alert's main action (unless a button or chart has keyboard focus)
        document.querySelector<HTMLButtonElement>(`#alert-${focusRef.current} [data-primary]`)?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown.length]);
  useEffect(() => {
    document.getElementById(`alert-${focus}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focus]);

  return (
    <>
      <PageHeader
        crumb={<span>Monitor the kitchen</span>}
        title="Alerts"
        summary={
          recent.data ? (
            visible ? (
              <>
                <b>
                  {visible} {visible === 1 ? 'alert' : 'alerts'}
                </b>{' '}
                right now{urgent > 0 && <>, <b>{urgent} critical</b></>}. Each one says why it fired; silence what you&apos;ve already handled.
              </>
            ) : (
              <>Nothing needs you right now. Alerts appear when stock runs low or prices move past your rules.</>
            )
          ) : (
            'Stock, spoilage and price-change notifications.'
          )
        }
        actions={
          <Segmented
            label="Filter alerts"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'stock', label: 'Stock' },
              { value: 'price', label: 'Price' },
              { value: 'system', label: 'Data' },
            ]}
          />
        }
      />

      <div className="stagger grid gap-4 lg:grid-cols-12">
        <Card label="Recent alerts" className="lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-2 pt-5 sm:px-6">
            <div className="flex items-center gap-2 text-[12px] text-faint">
              <Kbd>J</Kbd>
              <Kbd>K</Kbd>
              <span>to move</span>
              <span className="hidden items-center gap-2 sm:inline-flex">
                <Kbd>Enter</Kbd>
                <span>to open</span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              {hiddenCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setShowHidden((v) => !v)} aria-pressed={showHidden}>
                  {showHidden ? 'Hide silenced' : `Show ${hiddenCount} silenced`}
                </Button>
              )}
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={recent.reload} loading={recent.loading && !!recent.data}>
                Refresh
              </Button>
            </div>
          </div>

          {lastMuted && (
            <div role="status" className="mx-5 mb-2 flex items-center justify-between gap-3 rounded-[14px] bg-ink px-4 py-2.5 text-[13px] text-white sm:mx-6">
              <span>{lastMuted.title}.</span>
              <button type="button" onClick={() => restore(lastMuted.id)} className="inline-flex items-center gap-1.5 font-semibold text-[#c4c5ff] hover:text-white">
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </button>
            </div>
          )}

          <div className="px-3 pb-3">
            {recent.error ? (
              <div className="px-2 pb-2">
                <ErrorNote>Couldn&apos;t load alerts: {recent.error}</ErrorNote>
              </div>
            ) : !recent.data ? (
              <div className="space-y-2 px-2 pb-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 rounded-tile p-2">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3 rounded-full" />
                      <Skeleton className="h-3 w-1/2 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : shown.length === 0 ? (
              <Empty icon={BellOff} title={filter === 'all' ? 'All clear' : `No ${filter === 'system' ? 'data' : filter} alerts`} body="When stock runs low or prices move past your rules, it shows up here." />
            ) : (
              <ul role="listbox" aria-label="Alerts" aria-activedescendant={`alert-${focus}`}>
                {shown.map((a, i) => (
                  <AlertRow
                    key={a.id}
                    index={i}
                    alert={a}
                    kind={kindOf(a)}
                    settings={settings}
                    focused={i === focus}
                    hidden={isMuted(muted, a.id)}
                    onFocus={() => setFocus(i)}
                    onMute={mute}
                    onRestore={restore}
                  />
                ))}
              </ul>
            )}
            {more > 0 && !recent.error && (
              <div className="px-2 pt-2">
                <Button variant="ghost" size="sm" icon={ChevronDown} className="w-full" loading={recent.loading} onClick={() => setLimit((l) => Math.min(100, l + PAGE))}>
                  Show {Math.min(PAGE, more)} more of {total}
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card label="Alert rules" className="lg:col-span-4">
          <CardHeader title="Alert rules" subtitle="Thresholds, and where alerts go." />
          <form onSubmit={save} className="px-5 pb-5 sm:px-6">
            <div className="space-y-4">
              <Field label="Low stock" type="number" min={0} step={1} suffix="days" hint="Alert when an item will run out within this many days." value={settings.low_stock_threshold} onChange={(e) => set('low_stock_threshold', Number(e.target.value))} />
              <Field label="Price move" type="number" min={0} step={0.5} suffix="%" hint="Alert when a forecast moves at least this much." value={settings.price_change_alert} onChange={(e) => set('price_change_alert', Number(e.target.value))} />
              <Field label="Spoilage" type="number" min={0} step={1} suffix="days" hint="Warn this many days before stock passes its shelf life." value={settings.spoilage_warning} onChange={(e) => set('spoilage_warning', Number(e.target.value))} />
            </div>
            <div className="mt-5 divide-y divide-line border-t border-line">
              <Switch label="Email" description="Daily summaries and critical alerts" checked={settings.email_notifications} onChange={(v) => set('email_notifications', v)} />
              <Switch label="Text message" description="Critical alerts only" checked={settings.sms_notifications} onChange={(v) => set('sms_notifications', v)} />
              <Switch label="Push" description="On this device" checked={settings.push_notifications} onChange={(v) => set('push_notifications', v)} />
            </div>
            <div className="mt-2 border-t border-line pt-4">
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
              <p role="status" className={cx('mt-4 flex items-center gap-2 text-[13px] font-semibold', result.ok ? 'text-good' : 'text-bad')}>
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

function AlertRow({
  index,
  alert: a,
  kind,
  settings,
  focused,
  hidden,
  onFocus,
  onMute,
  onRestore,
}: {
  index: number;
  alert: AlertItem;
  kind: Kind;
  settings: AlertSettings;
  focused: boolean;
  hidden: boolean;
  onFocus: () => void;
  onMute: (a: AlertItem, ms: number) => void;
  onRestore: (id: string) => void;
}) {
  const k = KIND[kind];
  const Icon = k.icon;
  const { setSelectedCommodity } = useCommodityActions();

  const open = () => {
    if (!a.commodity) return goToTab('refresh');
    setSelectedCommodity(a.commodity);
    goToTab(kind === 'rising' || kind === 'falling' ? 'predictions' : 'ordering');
  };

  return (
    <li
      id={`alert-${index}`}
      role="option"
      aria-selected={focused}
      onClick={onFocus}
      className={cx(
        'cursor-pointer rounded-[18px] px-3 py-3 transition-colors [&+&]:mt-1',
        focused ? 'bg-surface-2 ring-1 ring-line-2' : 'hover:bg-surface-2/70',
        hidden && 'opacity-55'
      )}
    >
      <div className="flex items-start gap-3">
        {a.commodity ? (
          <ProduceIcon commodity={a.commodity} size={40} bubble animated={focused} />
        ) : (
          <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', k.tile)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-semibold', k.tile)}>
              <Icon className="h-3 w-3" /> {k.tag}
            </span>
            {a.type === 'critical' && <span className="micro text-bad">Critical</span>}
            <span className="ml-auto text-[11.5px] text-faint">{a.timestamp}</span>
          </div>
          <p className={cx('mt-1.5 leading-snug text-ink', focused ? 'font-display text-[24px] leading-[1.15] sm:text-[26px]' : 'text-[15px] font-semibold')}>{headline(a, kind, settings)}</p>
          {focused && <p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-muted">{why(kind, settings)}</p>}
        </div>
      </div>

      {focused && (
        <div className="mt-3 sm:pl-[52px]">
          {a.commodity && (kind === 'rising' || kind === 'falling') && <PriceEvidence commodity={a.commodity} alert={a} />}
          <div className="mt-3 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="primary" icon={ArrowUpRight} onClick={open} data-primary="">
              {a.commodity ? (kind === 'rising' || kind === 'falling' ? 'See forecast' : 'Plan an order') : 'Open data refresh'}
            </Button>
            {hidden ? (
              <Button size="sm" icon={Undo2} onClick={() => onRestore(a.id)}>
                Restore
              </Button>
            ) : (
              <>
                <Button size="sm" icon={BellOff} onClick={() => onMute(a, DAY)}>
                  Silence 24h
                </Button>
                <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => onMute(a, Infinity)}>
                  Not relevant
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

// Expected vs actual for a price alert: the usual band shaded around recent USDA weeks, the forecast
// that fired the alert in iris, and one line comparing that move with how much prices usually move.
function PriceEvidence({ commodity, alert }: { commodity: string; alert: AlertItem }) {
  const { selectedState, selectedZipCode } = useCommodityState();
  const trends = useApi<TrendChart>(`/30-day-trends?${qs({ commodity, state: selectedState, zip_code: selectedZipCode })}`);
  const data = useMemo(() => {
    const t = trends.data?.data ?? [];
    const by = (n: string) => t.find((x) => x.name === n);
    const a = by('Actual Price');
    const f = by('Forecast');
    const up = by('Upper Bound');
    const lo = by('Lower Bound');
    const actual: SeriesPoint[] = a ? a.x.map((x, i) => ({ date: x.slice(0, 10), value: a.y[i] })) : [];
    const forecast: RangePoint[] = f ? f.x.map((x, i) => ({ date: x.slice(0, 10), value: f.y[i], hi: up?.y[i], lo: lo?.y[i] })) : [];
    return { actual, forecast, band: usualBand(actual), weekly: usualWeeklyMove(actual) };
  }, [trends.data]);

  if (trends.error) return <p className="text-[12.5px] text-faint">The price chart didn&apos;t load ({trends.error}).</p>;
  if (!data.actual.length) return <Skeleton className="h-[160px]" />;

  const m = alert.message.match(/(rise|fall) ([\d.]+)%/);
  const move = m ? Number(m[2]) : undefined;
  const times = move !== undefined && data.weekly ? move / data.weekly : undefined;

  return (
    <div className="rounded-tile border border-line bg-surface p-2">
      {times !== undefined && data.weekly !== undefined && (
        <p className="px-2 pb-1 pt-1 text-[13px] text-muted [&_b]:font-semibold [&_b]:text-ink">
          {times >= 1.15 ? (
            <>
              That&apos;s <b>{num(times)}× more than usual</b>: these prices typically move about {num(data.weekly)}% a week.
            </>
          ) : (
            <>About the usual weekly move ({num(data.weekly)}%), but past your rule.</>
          )}
        </p>
      )}
      <AreaLine
        actual={data.actual.slice(-8)}
        expected={data.band?.expected.slice(-8)}
        forecast={data.forecast}
        height={150}
        showYAxis={false}
        animKey={commodity}
        label={`${commodity}: recent prices inside their usual band, and the forecast that triggered this alert.`}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-1 pt-1 text-[11.5px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-accent" /> Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-well ring-1 ring-line" /> Usual range
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed border-forecast" /> Forecast
        </span>
      </div>
    </div>
  );
}

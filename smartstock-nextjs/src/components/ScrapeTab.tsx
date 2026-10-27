'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, DatabaseZap, Globe, KeyRound, Loader2, X } from 'lucide-react';
import { postJSON } from '@/lib/api';
import type { Health } from '@/lib/types';
import { Button, Card, CardHeader, PageHeader, Pill, cx } from './ui';

type RunState = 'idle' | 'running' | 'done' | 'failed';

// What POST /scrape-and-train does, in order. The API answers once at the end,
// so steps show as a single running block rather than fake per-step progress.
const STEPS = [
  { title: 'Ask USDA for new weekly reports', detail: 'MyMarketNews API, report 3324, everything since the newest stored week' },
  { title: 'Add them to the training set', detail: 'Mapped to the training columns; re-published rows replace stored ones' },
  { title: 'Retrain every model', detail: 'One LightGBM model per vegetable, scored against last week’s price' },
];

const formatDate = (iso?: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const daysSince = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(`${iso.slice(0, 10)}T00:00:00`).getTime()) / 86400000) : undefined);

export default function ScrapeTab({ health }: { health?: Health }) {
  const [state, setState] = useState<RunState>('idle');
  const [message, setMessage] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [finishedAt, setFinishedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const run = async () => {
    setState('running');
    setMessage('');
    setElapsed(0);
    const started = Date.now();
    timer.current = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    try {
      const result = await postJSON<{ success: boolean; message?: string; error?: string }>('/scrape-and-train');
      if (!result.success) throw new Error(result.error || 'The scraper stopped without saying why.');
      setState('done');
      setMessage(result.message ?? 'New prices added and models retrained.');
    } catch (err) {
      setState('failed');
      setMessage((err as Error).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setFinishedAt(new Date());
    }
  };

  const age = daysSince(health?.latest_data_date);
  const stale = age !== undefined && age > 14;
  const needsKey = health !== undefined && health.usda_api_configured === false;
  // The server also refreshes on its own every time it starts
  const serverRefreshing = state !== 'running' && health?.data_refresh_running === true;

  return (
    <>
      <PageHeader
        crumb={<>Monitor <span className="mx-1.5">›</span> Data refresh</>}
        title="Data refresh"
        summary={
          <>
            Prices come from USDA Market News. The newest report in the training set is from <b>{formatDate(health?.latest_data_date)}</b>
            {age !== undefined && <> ({age} days ago)</>}.
          </>
        }
        actions={
          <Button variant="primary" icon={DatabaseZap} onClick={run} loading={state === 'running' || serverRefreshing} disabled={needsKey}>
            {state === 'running' || serverRefreshing ? 'Refreshing…' : 'Pull latest prices'}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Source */}
        <Card>
          <CardHeader
            title="Source"
            action={<Pill tone={needsKey || stale ? 'warn' : 'good'}>{needsKey ? 'Needs API key' : stale ? 'Behind' : 'Up to date'}</Pill>}
          />
          <div className="px-5 pb-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#e6ecf7] text-info">
                <Globe className="h-5 w-5" />
              </span>
              <div>
                <div className="text-[15px] font-semibold">USDA MyMarketNews</div>
                <a href="https://mymarketnews.ams.usda.gov/viewReport/3324" target="_blank" rel="noreferrer" className="text-[12.5px] text-muted underline decoration-line-2 underline-offset-2 hover:text-ink">
                  National Retail Report, Specialty Crops
                </a>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-2">
              <Fact label="Rows in training set" value={health?.training_rows?.toLocaleString() ?? '—'} />
              <Fact label="Newest report" value={formatDate(health?.latest_data_date)} />
              <Fact label="Models trained" value={health ? `${health.models_trained} of ${health.viable_commodities}` : '—'} />
              <Fact label="Last refresh here" value={finishedAt ? finishedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Not this session'} />
            </dl>
            {needsKey && (
              <div className="mt-5 flex gap-3 rounded-tile border border-[#d99a1e]/30 bg-[#d99a1e]/10 p-3.5 text-[12.5px] leading-relaxed text-warn">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Data refresh needs a free USDA API key. Create one at{' '}
                  <a href="https://mymarketnews.ams.usda.gov" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
                    mymarketnews.ams.usda.gov
                  </a>{' '}
                  (My Profile, API Key), then add it as <code className="rounded bg-white/60 px-1">MARS_API_KEY</code> in the server&apos;s environment.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Run */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Refresh run"
            subtitle={serverRefreshing ? 'The server pulls the latest USDA reports every time it starts. This one is running now.' : state === 'idle' ? 'What happens when you pull the latest prices. It also runs every time the server starts.' : state === 'running' ? `Running for ${elapsed}s. This usually takes under a minute.` : state === 'done' ? `Finished in ${elapsed}s.` : `Stopped after ${elapsed}s.`}
            action={serverRefreshing ? <Pill tone="info">Running</Pill> : state !== 'idle' && <Pill tone={state === 'running' ? 'info' : state === 'done' ? 'good' : 'bad'}>{state === 'running' ? 'Running' : state === 'done' ? 'Succeeded' : 'Failed'}</Pill>}
          />
          <ol className="relative px-5 pb-2">
            {STEPS.map((step, i) => {
              const status = state === 'done' ? 'done' : state === 'failed' ? 'failed' : state === 'running' || serverRefreshing ? 'running' : 'pending';
              return (
                <li key={step.title} className="relative flex gap-4 pb-5 last:pb-3">
                  {i < STEPS.length - 1 && <span className={cx('absolute left-[15px] top-8 h-[calc(100%-24px)] w-0.5', status === 'done' ? 'bg-primary/50' : 'bg-line')} aria-hidden="true" />}
                  <span
                    className={cx(
                      'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold',
                      status === 'done' && 'bg-primary text-on-primary',
                      status === 'failed' && 'bg-bad/10 text-bad',
                      status === 'running' && 'bg-info/10 text-info',
                      status === 'pending' && 'border border-line-2 bg-surface text-muted'
                    )}
                  >
                    {status === 'done' ? <Check className="h-4 w-4" strokeWidth={3} /> : status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : status === 'failed' ? <X className="h-4 w-4" /> : i + 1}
                  </span>
                  <div className="pt-1">
                    <div className="text-[14px] font-semibold">{step.title}</div>
                    <div className="text-[12.5px] text-muted">{step.detail}</div>
                  </div>
                </li>
              );
            })}
          </ol>
          {message && (
            <div className={cx('mx-5 mb-5 rounded-tile px-4 py-3 text-[13px]', state === 'done' ? 'bg-good/8 text-good' : 'bg-bad/8 text-bad')}>
              <b className="font-semibold">{state === 'done' ? 'Done. ' : 'The refresh failed. '}</b>
              <span className="break-words">{message}</span>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-tile border border-line px-3 py-2.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="tabular mt-0.5 text-[14.5px] font-semibold">{value}</dd>
    </div>
  );
}

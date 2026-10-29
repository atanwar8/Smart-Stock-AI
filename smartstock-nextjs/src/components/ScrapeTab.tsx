'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CloudOff, Database, DatabaseZap, History, KeyRound, Loader2, RefreshCw, ServerOff, SkipForward, X } from 'lucide-react';
import { useApi } from '@/lib/api';
import { PIPELINE_STEPS, progressFraction, startPipelineRefresh, usePipelineStatus } from '@/lib/pipeline';
import type { Health, IngestRun, Page, PipelineStatus } from '@/lib/types';
import { count } from '@/lib/words';
import { Button, Card, CardHeader, Empty, ErrorNote, IconButton, Micro, PageHeader, Pill, Skeleton, Stat, cx, type Tone } from './ui';

// Data refresh: the Extract -> Load -> Train -> Test pipeline (SPEC §5, /pipeline/*), the store it fills,
// and the history of runs. The night card is the live pipeline; everything else is paper.

const RUNS_PAGE = 8;

const formatDate = (iso?: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const formatWhen = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

const daysSince = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(`${iso.slice(0, 10)}T00:00:00`).getTime()) / 86400000) : undefined);

const duration = (from?: string | null, to?: string | null) => {
  if (!from) return undefined;
  const s = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000));
  if (Number.isNaN(s)) return undefined;
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

const RUN_TONE: Record<string, Tone> = { succeeded: 'good', failed: 'bad', running: 'info', skipped: 'neutral' };
const RUN_LABEL: Record<string, string> = { succeeded: 'Succeeded', failed: 'Failed', running: 'Running', skipped: 'Skipped' };

// "seed:csv" -> "Seed from CSV"; "usda" / "usda:api" -> "USDA refresh"
const sourceLabel = (source?: string) => {
  if (!source) return 'Refresh';
  if (source.startsWith('seed')) return 'Seed from CSV';
  if (/usda|api|refresh/i.test(source)) return 'USDA refresh';
  return source;
};

type StepState = 'done' | 'running' | 'failed' | 'skipped' | 'pending';

// Where each of the four steps stands, from the live status (or the last run when idle)
function stepStates(status?: PipelineStatus): StepState[] {
  const ids = PIPELINE_STEPS.map((s) => s.id);
  if (!status) return ids.map(() => 'pending');
  const at = status.step && status.step !== 'done' ? ids.indexOf(status.step) : -1;
  const lastStatus = status.last_run?.status;
  if (status.state === 'running') return ids.map((_, i) => (at < 0 ? 'pending' : i < at ? 'done' : i === at ? 'running' : 'pending'));
  if (status.state === 'failed' || (status.state === 'idle' && lastStatus === 'failed')) {
    const failedAt = at < 0 ? 0 : at;
    return ids.map((_, i) => (i < failedAt ? 'done' : i === failedAt ? 'failed' : 'pending'));
  }
  // A skipped run had nothing new to extract or load, but still trained and tested on what is stored
  if (lastStatus === 'skipped') return ids.map((id) => (id === 'extract' || id === 'load' ? 'skipped' : 'done'));
  if (status.state === 'succeeded' || lastStatus === 'succeeded') return ids.map(() => 'done');
  return ids.map(() => 'pending');
}

export default function ScrapeTab({ health }: { health?: Health }) {
  const pipeline = usePipelineStatus();
  const { status, unavailable, reload: reloadStatus } = pipeline;
  const running = status?.state === 'running';

  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'bad'; text: string } | null>(null);

  const [offset, setOffset] = useState(0);
  const runs = useApi<Page<IngestRun>>(unavailable ? null : `/pipeline/runs?limit=${RUNS_PAGE}&offset=${offset}`);
  const { reload: reloadRuns } = runs;

  // When a run finishes, the history and the store figures change: refresh the list once
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) reloadRuns();
    wasRunning.current = running;
  }, [running, reloadRuns]);

  // A clock for "running for 42s"
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const keyConfigured = status?.usda_api_configured ?? health?.usda_api_configured;
  const needsKey = keyConfigured === false;

  const refresh = useCallback(async () => {
    setStarting(true);
    setNotice(null);
    try {
      const res = await startPipelineRefresh();
      if (res.alreadyRunning) setNotice({ tone: 'info', text: 'A refresh is already running; following that one.' });
      reloadStatus();
      setOffset(0);
      reloadRuns();
    } catch (err) {
      setNotice({ tone: 'bad', text: `Couldn't start the refresh: ${(err as Error).message}` });
    } finally {
      setStarting(false);
    }
  }, [reloadStatus, reloadRuns]);

  // Coverage: the store from the pipeline, or the older /health figures when the pipeline isn't there
  const store = status?.store;
  const lastDate = store?.last_date ?? health?.latest_data_date;
  const age = daysSince(lastDate);
  const rows = store?.rows ?? health?.training_rows;

  return (
    <>
      <PageHeader
        crumb={
          <>
            Monitor <span className="mx-1.5">›</span> Data refresh
          </>
        }
        title="Data refresh"
        summary={
          rows !== undefined ? (
            <>
              The store holds <b>{rows.toLocaleString()} weekly prices</b>
              {store?.commodities ? (
                <>
                  {' '}
                  for <b>{count(store.commodities, 'kind of produce', 'kinds of produce')}</b>
                </>
              ) : null}{' '}
              from USDA Market News. The newest week is <b>{formatDate(lastDate)}</b>
              {age !== undefined && <> ({age} days ago)</>}.
            </>
          ) : (
            'Prices come from USDA Market News. A refresh pulls only the new weeks, then retrains and retests every model.'
          )
        }
        actions={
          <Button
            variant="primary"
            icon={DatabaseZap}
            onClick={refresh}
            loading={starting || running}
            disabled={needsKey || unavailable || pipeline.loading || (!!pipeline.error && !status)}
            title={needsKey ? 'Needs a USDA API key (MARS_API_KEY) on the server' : undefined}
          >
            {running ? 'Refreshing…' : 'Pull latest prices'}
          </Button>
        }
      />

      {notice && (
        <div className="mb-4">
          {notice.tone === 'bad' ? (
            <ErrorNote>{notice.text}</ErrorNote>
          ) : (
            <p role="status" className="rounded-tile bg-info/[0.07] px-3.5 py-2.5 text-[13px] text-info">
              {notice.text}
            </p>
          )}
        </div>
      )}

      <div className="stagger grid gap-4 lg:grid-cols-12">
        {pipeline.loading ? (
          <>
            <PipelineSkeleton />
            <Card className="p-5 sm:p-6 lg:col-span-4">
              <div role="status" aria-label="Loading the store" className="space-y-3">
                <Skeleton className="h-4 w-32 rounded-full" />
                <div className="grid grid-cols-2 gap-4 pt-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
                <Skeleton className="h-16" />
              </div>
            </Card>
          </>
        ) : (
          <>
            {unavailable ? (
              <Card label="Refresh pipeline" className="lg:col-span-8">
                <Empty
                  icon={ServerOff}
                  title="Pipeline not available on this server"
                  body="This API doesn't have the /pipeline routes, so refreshes can't be started or tracked here. The store figures come from the server's health check."
                  action={
                    <Button size="sm" icon={RefreshCw} onClick={reloadStatus}>
                      Check again
                    </Button>
                  }
                />
              </Card>
            ) : pipeline.error && !status ? (
              <Card label="Refresh pipeline" className="lg:col-span-8">
                <Empty
                  icon={CloudOff}
                  title="Couldn't reach the pipeline"
                  body={`The status request failed (${pipeline.error}). Check that the API is running, then try again.`}
                  action={
                    <Button size="sm" icon={RefreshCw} onClick={reloadStatus}>
                      Try again
                    </Button>
                  }
                />
              </Card>
            ) : (
              status && <PipelineCard status={status} stale={!!pipeline.error} />
            )}
            <StoreCard status={status} health={health} needsKey={needsKey} />
          </>
        )}

        {!unavailable && <RunsCard runs={runs} offset={offset} setOffset={setOffset} />}
      </div>
    </>
  );
}

/* ---------- The live pipeline (night card) ---------- */

const NIGHT_PILL: Record<string, { dot: string; text: string }> = {
  running: { dot: 'bg-[#a5a6ff]', text: 'Running' },
  failed: { dot: 'bg-[#fb7185]', text: 'Failed' },
  skipped: { dot: 'bg-night-ink/50', text: 'Skipped' },
  ok: { dot: 'bg-[#7ee2b8]', text: 'Up to date' },
  behind: { dot: 'bg-[#fbbf24]', text: 'Behind' },
};

// USDA publishes weekly, so a newest week older than this means refreshes aren't happening
const BEHIND_DAYS = 14;

function PipelineCard({ status, stale }: { status: PipelineStatus; stale: boolean }) {
  const states = useMemo(() => stepStates(status), [status]);
  const running = status.state === 'running';
  const last = status.last_run;
  const progress = progressFraction(status.progress);
  const skipped = !running && last?.status === 'skipped';
  const failed = !running && (status.state === 'failed' || last?.status === 'failed');

  let headline: string;
  if (running) headline = status.message || 'Refreshing the store…';
  else if (failed) headline = 'The last refresh stopped early.';
  else if (skipped) headline = 'No new weeks from USDA. Models were retested on what is stored.';
  // The first ingest run is the bundled CSV seed, not a USDA pull: say so instead of "Last refresh added 6,783 rows"
  else if (last?.source?.startsWith('seed')) headline = 'Started from the bundled USDA history. No refresh from USDA has run yet.';
  else if (last) headline = `Last refresh added ${count(last.rows_inserted ?? 0, 'new row')}.`;
  else headline = 'No refresh has run yet.';

  const newest = status.store?.last_date ? Date.parse(status.store.last_date) : NaN;
  const behind = Number.isFinite(newest) && (Date.now() - newest) / 86_400_000 > BEHIND_DAYS;
  const pill = running ? NIGHT_PILL.running : failed ? NIGHT_PILL.failed : skipped ? NIGHT_PILL.skipped
    : last ? (behind ? NIGHT_PILL.behind : NIGHT_PILL.ok) : null;
  const runningFor = duration(last?.status === 'running' ? last.started_at : undefined);
  const took = last ? duration(last.started_at, last.finished_at) : undefined;

  return (
    <Card tone="night" label="Refresh pipeline" className="lg:col-span-8">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-[#5b5bd6]/25 blur-3xl" />
      <div className="relative px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-white">Pipeline</div>
            <Micro className="text-night-ink/55">Extract, load, train, test</Micro>
          </div>
          {pill && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/10 px-2.5 py-[3px] text-[12px] font-semibold text-night-ink">
              <span className={cx('h-1.5 w-1.5 rounded-full', pill.dot, running && 'animate-pulse')} />
              {pill.text}
            </span>
          )}
        </div>

        <p aria-live="polite" className="mt-5 max-w-[34ch] font-display text-[28px] leading-[1.1] text-white sm:text-[34px]">
          {headline}
        </p>
        <p className="mt-2 text-[12.5px] text-night-ink/60">
          {running
            ? `Running${runningFor ? ` for ${runningFor}` : ''}. Checking every 1.5 seconds.`
            : last
            ? `Finished ${formatWhen(last.finished_at ?? last.started_at)}${took ? `, took ${took}` : ''}.`
            : 'Press Pull latest prices to run the first refresh.'}
          {stale && ' The last status check failed, so this may be out of date.'}
        </p>

        {/* Stepper: four columns that stay side by side down to phone width */}
        <ol className="mt-6 grid grid-cols-4 gap-1.5 sm:gap-3" aria-label="Pipeline steps">
          {PIPELINE_STEPS.map((step, i) => (
            <StepCell key={step.id} title={step.title} detail={step.detail} state={states[i]} index={i} last={i === PIPELINE_STEPS.length - 1} />
          ))}
        </ol>

        {running && (
          <div className="mt-5">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
              role="progressbar"
              aria-label="Refresh progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div className="h-full rounded-full bg-[#a5a6ff] transition-[width] duration-700 ease-spring" style={{ width: `${Math.max(4, progress * 100)}%` }} />
            </div>
            <div className="tabular mt-1.5 text-right font-mono text-[11px] text-night-ink/55">{Math.round(progress * 100)}%</div>
          </div>
        )}

        {failed && (last?.error || status.message) && (
          <div role="alert" className="mt-5 rounded-tile bg-[#fb7185]/[0.12] px-4 py-3 text-[13px] text-[#fda4af]">
            <b className="font-semibold text-[#fecdd3]">What went wrong: </b>
            <span className="break-words">{last?.error || status.message}</span>
          </div>
        )}

        {last && !running && (
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-white/[0.08] pt-4">
            <NightFact label="Fetched" value={(last.rows_fetched ?? 0).toLocaleString()} note="rows from USDA" />
            <NightFact label="New" value={(last.rows_inserted ?? 0).toLocaleString()} note="rows added" />
            <NightFact label="Updated" value={(last.rows_updated ?? 0).toLocaleString()} note="corrected rows" />
          </dl>
        )}
      </div>
    </Card>
  );
}

const STEP_SR: Record<StepState, string> = { done: 'done', running: 'in progress', failed: 'failed', skipped: 'skipped', pending: 'not started' };

function StepCell({ title, detail, state, index, last }: { title: string; detail: string; state: StepState; index: number; last: boolean }) {
  return (
    <li className="relative min-w-0" aria-current={state === 'running' ? 'step' : undefined}>
      {/* The connector to the next step fills in once this one is done */}
      {!last && (
        <span aria-hidden="true" className="absolute left-[calc(50%+22px)] right-[calc(-50%+22px)] top-[17px] h-0.5 rounded-full bg-white/10 sm:left-[46px] sm:right-[-2px]">
          <span className={cx('block h-full rounded-full bg-[#7ee2b8] transition-[width] duration-500 ease-spring', state === 'done' || state === 'skipped' ? 'w-full' : 'w-0')} />
        </span>
      )}
      <div className="flex flex-col items-center text-center sm:items-start sm:text-left">
        <span
          className={cx(
            'relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-[12.5px] font-semibold transition-colors duration-300',
            state === 'done' && 'bg-[#7ee2b8] text-night',
            state === 'running' && 'bg-[#a5a6ff]/20 text-[#c4c5ff] ring-2 ring-[#a5a6ff]/60',
            state === 'failed' && 'bg-[#fb7185]/20 text-[#fda4af] ring-2 ring-[#fb7185]/50',
            state === 'skipped' && 'bg-white/[0.08] text-night-ink/70',
            state === 'pending' && 'bg-white/[0.05] text-night-ink/50 ring-1 ring-white/10'
          )}
        >
          {state === 'done' ? (
            <Check className="h-4 w-4" strokeWidth={3} />
          ) : state === 'running' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : state === 'failed' ? (
            <X className="h-4 w-4" strokeWidth={2.5} />
          ) : state === 'skipped' ? (
            <SkipForward className="h-4 w-4" />
          ) : (
            <span className="font-mono">{index + 1}</span>
          )}
        </span>
        <div className="mt-2.5 text-[13px] font-semibold text-white">
          {title}
          <span className="sr-only">, {STEP_SR[state]}</span>
        </div>
        <div className="mt-0.5 hidden text-[12px] leading-snug text-night-ink/55 sm:block">{detail}</div>
        {state === 'skipped' && <div className="micro mt-0.5 text-night-ink/55 sm:hidden">skipped</div>}
      </div>
    </li>
  );
}

function NightFact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0">
      <dt className="micro text-night-ink/50">{label}</dt>
      <dd className="tabular mt-1 truncate font-display text-[24px] leading-none text-white">{value}</dd>
      <dd className="mt-1 truncate text-[11.5px] text-night-ink/55">{note}</dd>
    </div>
  );
}

function PipelineSkeleton() {
  return (
    <Card tone="night" className="p-5 sm:p-7 lg:col-span-8">
      <div role="status" aria-label="Loading the pipeline" className="space-y-3">
        <Skeleton night className="h-4 w-28 rounded-full" />
        <Skeleton night className="mt-4 h-9 w-4/5 rounded-[12px]" />
        <Skeleton night className="h-3 w-1/2 rounded-full" />
        <div className="grid grid-cols-4 gap-3 pt-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton night key={i} className="h-16" />
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ---------- The store ---------- */

function StoreCard({ status, health, needsKey }: { status?: PipelineStatus; health?: Health; needsKey: boolean }) {
  const store = status?.store;
  const first = store?.first_date;
  const last = store?.last_date ?? health?.latest_data_date;
  const age = daysSince(last);
  const behind = age !== undefined && age > 14;
  const backend = store?.backend === 'supabase' ? 'Supabase' : store?.backend === 'local' ? 'Local SQLite' : store?.backend;

  // How much of "first stored week -> today" the store covers; the gap at the end is how far behind it is
  const span = useMemo(() => {
    if (!first || !last) return null;
    const t0 = new Date(`${first.slice(0, 10)}T00:00:00`).getTime();
    const t1 = new Date(`${last.slice(0, 10)}T00:00:00`).getTime();
    const now = Date.now();
    if (!(now > t0)) return null;
    return Math.max(0.02, Math.min(1, (t1 - t0) / (now - t0)));
  }, [first, last]);

  return (
    <Card label="Training store" className="lg:col-span-4">
      <CardHeader
        title="Training store"
        subtitle={backend ? `Kept in ${backend}. Every refresh adds to it; nothing is deleted.` : 'What the models learn from.'}
        action={backend && <Pill tone={store?.backend === 'supabase' ? 'good' : 'neutral'}>{backend}</Pill>}
      />
      <div className="px-5 pb-5 sm:px-6">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <Stat label="Weekly prices" value={(store?.rows ?? health?.training_rows)?.toLocaleString() ?? '—'} />
          <Stat label="Produce" value={store?.commodities ?? health?.viable_commodities ?? '—'} />
          <Stat label="First week" value={<span className="text-[21px]">{formatDate(first)}</span>} />
          <Stat label="Newest week" value={<span className="text-[21px]">{formatDate(last)}</span>} note={age !== undefined ? `${age} days ago` : undefined} />
        </div>

        {span !== null && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-[11.5px] text-faint">
              <Micro>Coverage</Micro>
              <span>{behind ? `${age} days behind today` : 'Current'}</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-well" role="img" aria-label={`The store covers ${Math.round(span * 100)}% of the time from its first week to today.`}>
              <div className={cx('h-full rounded-full', behind ? 'bg-[#d99a1e]' : 'bg-accent')} style={{ width: `${span * 100}%` }} />
            </div>
          </div>
        )}

        {needsKey ? (
          <div className="mt-5 flex gap-3 rounded-tile border border-[#d99a1e]/30 bg-[#d99a1e]/10 p-3.5 text-[12.5px] leading-relaxed text-warn">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Refreshing needs a free USDA API key. Create one at{' '}
              <a href="https://mymarketnews.ams.usda.gov" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
                mymarketnews.ams.usda.gov
              </a>{' '}
              (My Profile, API Key), then set <code className="rounded bg-white/60 px-1 font-mono">MARS_API_KEY</code> in the server&apos;s environment and restart it.
            </p>
          </div>
        ) : (
          <p className="mt-5 flex items-center gap-2 text-[12.5px] text-muted">
            <Database className="h-4 w-4 shrink-0 text-faint" />
            <span>
              Source:{' '}
              <a href="https://mymarketnews.ams.usda.gov/viewReport/3324" target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-2 hover:text-ink">
                USDA National Retail Report
              </a>
            </span>
          </p>
        )}
      </div>
    </Card>
  );
}

/* ---------- Run history ---------- */

function RunsCard({
  runs,
  offset,
  setOffset,
}: {
  runs: { data?: Page<IngestRun>; error?: string; loading: boolean; reload: () => void };
  offset: number;
  setOffset: (n: number) => void;
}) {
  const page = runs.data;
  const total = page?.total ?? 0;
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + RUNS_PAGE, total);

  return (
    <Card label="Refresh history" className="lg:col-span-12">
      <CardHeader
        title="Refresh history"
        subtitle={page ? `${count(total, 'run')} recorded, newest first.` : 'Every refresh and the seed, newest first.'}
        action={
          total > RUNS_PAGE ? (
            <div className="flex items-center gap-2">
              <span className="tabular hidden font-mono text-[11.5px] text-faint sm:inline">
                {from}–{to} of {total}
              </span>
              <IconButton icon={ChevronLeft} label="Newer runs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - RUNS_PAGE))} className="disabled:opacity-40" />
              <IconButton icon={ChevronRight} label="Older runs" disabled={to >= total} onClick={() => setOffset(offset + RUNS_PAGE)} className="disabled:opacity-40" />
            </div>
          ) : (
            <IconButton icon={RefreshCw} label="Reload history" onClick={runs.reload} />
          )
        }
      />
      <div className={cx('px-3 pb-3 transition-opacity', runs.loading && page && 'opacity-60')} aria-busy={runs.loading}>
        {runs.error && !page ? (
          <div className="px-2 pb-2">
            <ErrorNote>Couldn&apos;t load the history: {runs.error}</ErrorNote>
          </div>
        ) : !page ? (
          <div className="space-y-2 px-2 pb-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2 rounded-full" />
                  <Skeleton className="h-3 w-1/3 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : page.items.length === 0 ? (
          <Empty icon={History} title="No runs yet" body="The first refresh, or the automatic seed of a new store, shows up here." />
        ) : (
          <ul className="divide-y divide-line">
            {page.items.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        )}
        {total > RUNS_PAGE && (
          <p className="tabular px-3 pt-2 text-center font-mono text-[11.5px] text-faint sm:hidden">
            {from}–{to} of {total}
          </p>
        )}
      </div>
    </Card>
  );
}

const RUN_ICON_TILE: Record<Tone, string> = {
  good: 'bg-good/10 text-good',
  bad: 'bg-bad/10 text-bad',
  info: 'bg-info/10 text-info',
  warn: 'bg-[#d99a1e]/14 text-warn',
  forecast: 'bg-forecast-soft text-forecast',
  neutral: 'bg-well text-muted',
};

function RunRow({ run }: { run: IngestRun }) {
  const tone = RUN_TONE[run.status] ?? 'neutral';
  const took = duration(run.started_at, run.finished_at);
  const skipped = run.status === 'skipped';
  const Icon = run.status === 'succeeded' ? Check : run.status === 'failed' ? X : run.status === 'running' ? Loader2 : skipped ? SkipForward : History;
  return (
    <li className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1.5 px-2 py-3 sm:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-x-5">
      <span className={cx('flex h-9 w-9 items-center justify-center rounded-full', RUN_ICON_TILE[tone])}>
        <Icon className={cx('h-4 w-4', run.status === 'running' && 'animate-spin')} strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-ink">{sourceLabel(run.source)}</span>
          <Pill tone={tone}>{RUN_LABEL[run.status] ?? run.status}</Pill>
        </div>
        <div className="mt-0.5 text-[12.5px] text-muted">
          {formatWhen(run.started_at)}
          {took && <> · {took}</>}
        </div>
      </div>
      <div className="col-start-2 min-w-0 text-[12.5px] text-muted sm:col-start-auto">
        {run.window_start || run.window_end ? (
          <span>
            Weeks {formatDate(run.window_start)} → {formatDate(run.window_end)}
          </span>
        ) : (
          <span className="text-faint">No window recorded</span>
        )}
        {(run.error || (skipped && run.message)) && <p className={cx('mt-0.5 break-words', run.error ? 'text-bad' : 'text-faint')}>{run.error || run.message}</p>}
      </div>
      <div className="col-start-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-faint sm:col-start-auto sm:justify-end">
        <span title="Rows fetched from USDA">
          <b className="tabular font-semibold text-ink">{(run.rows_fetched ?? 0).toLocaleString()}</b> fetched
        </span>
        <span title="New rows added to the store">
          <b className="tabular font-semibold text-good">+{(run.rows_inserted ?? 0).toLocaleString()}</b> new
        </span>
        <span title="Existing rows USDA corrected">
          <b className="tabular font-semibold text-ink">{(run.rows_updated ?? 0).toLocaleString()}</b> updated
        </span>
      </div>
    </li>
  );
}

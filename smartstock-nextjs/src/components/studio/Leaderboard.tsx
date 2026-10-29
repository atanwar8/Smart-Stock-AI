'use client';

// Models ranked by hold-out error for the selected produce: one bar per model (MAE, shorter is better),
// with skill vs the baseline and how often the range caught the real price. Click a row to try that model.

import { memo } from 'react';
import { Crown } from 'lucide-react';
import type { Leaderboard as Board } from '@/lib/studio';
import type { Load } from './useStudio';
import { MINUS, cx, finite, fullDate, money, pct, shortDate, unitSuffix } from './format';
import { ModelGlyph } from './ModelGlyph';
import { Eyebrow, FOCUS, Panel, Skeleton } from './primitives';

interface LeaderboardProps {
  board: Load<Board>;
  selected: string | null;
  available: Set<string>;
  onSelect: (id: string) => void;
  className?: string;
}

function skillText(skill: number) {
  const v = Math.round(skill * 100);
  if (v === 0) return 'baseline';
  return `${v > 0 ? '+' : MINUS}${Math.abs(v)}% skill`;
}

function Leaderboard({ board, selected, available, onSelect, className }: LeaderboardProps) {
  const data = board.status === 'ready' ? board.data : null;
  const rows = data ? [...data.rows].sort((a, b) => a.rank - b.rank) : [];
  const maxMae = Math.max(0.0001, ...rows.map((r) => r.mae).filter(finite));

  return (
    <Panel className={className} aria-labelledby="studio-board-title">
      <div className="px-5 pt-5 sm:px-6">
        <Eyebrow>{data ? `Hold-out · ${shortDate(data.test_start)} → ${fullDate(data.test_end)} · ${data.test_weeks} weeks` : 'Hold-out test'}</Eyebrow>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h2 id="studio-board-title" className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
            Leaderboard
          </h2>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">Shorter bar = smaller error</span>
        </div>
      </div>

      {board.status === 'loading' && (
        <div className="space-y-4 px-5 pb-6 pt-5 sm:px-6" aria-busy="true" aria-label="Loading leaderboard">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-2.5" />
            </div>
          ))}
        </div>
      )}

      {board.status === 'error' && <p className="px-5 pb-6 pt-4 text-[13.5px] leading-relaxed text-muted sm:px-6">No leaderboard yet: {board.message}</p>}

      {data && (
        <ol className="space-y-1 px-2.5 pb-3 pt-3 sm:px-3.5">
          {rows.map((r) => {
            const active = r.model === selected;
            const champion = data.champion === r.model;
            const canSelect = available.has(r.model);
            const width = finite(r.mae) ? Math.max(4, (r.mae / maxMae) * 100) : 0;
            return (
              <li key={r.model}>
                <button
                  type="button"
                  aria-pressed={active}
                  disabled={!canSelect}
                  onClick={() => onSelect(r.model)}
                  title={canSelect ? `Try ${r.name}` : `${r.name} isn't available on this server`}
                  className={cx(
                    'w-full rounded-tile px-2.5 py-2.5 text-left transition-colors duration-200 disabled:cursor-default',
                    active ? 'bg-forecast-soft/70' : 'hover:bg-well',
                    FOCUS,
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <span className={cx('w-4 shrink-0 text-center font-mono text-[11px] tabular', champion ? 'text-accent' : 'text-muted')}>{r.rank}</span>
                    <ModelGlyph id={r.model} size={15} className={active ? 'text-forecast' : 'text-muted'} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{r.name}</span>
                    {champion && (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                        <Crown aria-hidden className="h-3 w-3" />
                        Champion
                      </span>
                    )}
                    <span className="font-mono text-[12px] font-semibold text-ink tabular">{finite(r.mae) ? money(r.mae) : '—'}</span>
                  </span>
                  <span className="mt-2 flex items-center gap-2.5 pl-[26px]">
                    <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-well">
                      <span
                        className={cx('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-spring', champion ? 'bg-accent' : active ? 'bg-forecast' : 'bg-ink/25')}
                        style={{ width: `${width}%` }}
                      />
                    </span>
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-x-3 pl-[26px] font-mono text-[10.5px] text-muted tabular">
                    {finite(r.skill) && <span className={r.skill > 0 ? 'text-accent' : undefined}>{skillText(r.skill)}</span>}
                    {finite(r.coverage) && <span>caught {pct(r.coverage)}</span>}
                    {finite(r.mape) && <span>{r.mape.toFixed(1)}% off</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {data && (
        <p className="border-t border-line px-5 py-3.5 text-[12px] leading-snug text-muted sm:px-6">
          Error is the typical miss per {data.unit === 'each' ? 'item' : unitSuffix(data.unit).replace(/^\//, '').trim() || 'unit'} on weeks the models never saw. Skill compares
          with repeating last season&apos;s price.
        </p>
      )}
    </Panel>
  );
}

export default memo(Leaderboard);

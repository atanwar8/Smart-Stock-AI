'use client';

// Model cards from /forecast/models, with the hold-out skill from the leaderboard and how each one runs.
// TimesFM is the hero: the page's one dark "night market" card, spanning the row.

import { memo, useMemo, type KeyboardEvent } from 'react';
import { Check, Crown, Hourglass, Timer, Zap } from 'lucide-react';
import type { Leaderboard, StudioModel } from '@/lib/studio';
import { cx, finite, signedPct, speedLabel } from './format';
import { ModelGlyph } from './ModelGlyph';
import { Chip, FOCUS, Skeleton } from './primitives';
import { useRadioGroup } from './useRadioGroup';

interface ModelPickerProps {
  models: StudioModel[] | null;
  board: Leaderboard | null;
  selected: string | null;
  onSelect: (id: string) => void;
}

export const isHeroModel = (m: { id: string }) => m.id.toLowerCase().includes('timesfm');

function SpeedIcon({ speed }: { speed: string }) {
  const Icon = speed === 'fast' ? Zap : speed === 'slow' ? Hourglass : Timer;
  return <Icon aria-hidden className="h-3 w-3" />;
}

function ModeChip({ m, night }: { m: StudioModel; night?: boolean }) {
  if (!m.available || m.mode === 'unavailable') return <Chip tone={night ? 'night' : 'neutral'}>Unavailable</Chip>;
  if (m.mode === 'stored')
    return (
      <Chip tone={night ? 'night' : 'neutral'} title="Served from the latest offline run">
        Stored · computed offline
      </Chip>
    );
  return (
    <Chip tone={night ? 'night' : 'good'} dot>
      Live
    </Chip>
  );
}

function SkillChip({ skill, rank, champion, night }: { skill?: number; rank?: number; champion: boolean; night?: boolean }) {
  if (!finite(skill)) return null;
  const better = skill > 0.005;
  return (
    <Chip
      tone={night ? 'night' : better ? 'accent' : 'neutral'}
      title="Hold-out skill: how much smaller the error is than the seasonal-naive baseline on the same weeks"
    >
      {champion && <Crown aria-hidden className="h-3 w-3" />}
      {skill === 0 ? 'Baseline' : `${signedPct(skill * 100)} vs naive`}
      {rank ? <span className="opacity-70">· #{rank}</span> : null}
    </Chip>
  );
}

function ModelPicker({ models, board, selected, onSelect }: ModelPickerProps) {
  // Hero first, then the rest in server order
  const ordered = useMemo(() => (models ? [...models.filter(isHeroModel), ...models.filter((m) => !isHeroModel(m))] : []), [models]);
  const rows = useMemo(() => new Map((board?.rows ?? []).map((r) => [r.model, r])), [board]);
  const index = ordered.findIndex((m) => m.id === selected);
  const radio = useRadioGroup(
    ordered.length,
    index,
    (i) => onSelect(ordered[i].id),
    (i) => !ordered[i].available,
  );

  if (!models) {
    return (
      <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading models">
        <Skeleton className="h-[148px] sm:col-span-2" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[132px]" />
        ))}
      </div>
    );
  }

  return (
    <div role="radiogroup" aria-label="Forecasting model" className="grid gap-3 sm:grid-cols-2">
      {ordered.map((m, i) => {
        const row = rows.get(m.id);
        const active = m.id === selected;
        const disabled = !m.available;
        const champion = board?.champion === m.id;
        const common = {
          ref: radio.setRef(i),
          role: 'radio' as const,
          'aria-checked': active,
          'aria-disabled': disabled || undefined,
          tabIndex: radio.tabIndexFor(i),
          onKeyDown: (e: KeyboardEvent) => radio.onKeyDown(e, i),
          onClick: () => !disabled && onSelect(m.id),
        };

        if (isHeroModel(m)) {
          return (
            <button
              key={m.id}
              type="button"
              {...common}
              className={cx(
                'group relative overflow-hidden rounded-card bg-night p-5 text-left text-night-ink transition-[transform,box-shadow] duration-300 ease-spring sm:col-span-2',
                active ? 'shadow-[0_0_0_2px_var(--color-forecast),0_24px_48px_-24px_var(--color-forecast)]' : 'shadow-card hover:-translate-y-0.5',
                disabled && 'cursor-not-allowed opacity-70',
                FOCUS,
              )}
            >
              {/* luminous iris bands, like a long exposure of the forecast cone */}
              <svg aria-hidden viewBox="0 0 400 160" preserveAspectRatio="none" className="pointer-events-none absolute inset-y-0 right-0 h-full w-[70%] opacity-80">
                <defs>
                  <linearGradient id="studio-hero-band" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor="var(--color-forecast)" stopOpacity="0" />
                    <stop offset="100%" stopColor="var(--color-forecast)" stopOpacity="0.55" />
                  </linearGradient>
                </defs>
                <path d="M0 120 C 120 118, 200 96, 400 30 L 400 150 C 220 140, 120 128, 0 124 Z" fill="url(#studio-hero-band)" opacity="0.5" />
                <path d="M0 118 C 140 114, 230 84, 400 58" stroke="var(--color-forecast)" strokeWidth="1.5" strokeDasharray="4 6" fill="none" opacity="0.9" />
                <path d="M0 122 C 150 120, 250 110, 400 118" stroke="var(--color-night-ink)" strokeOpacity="0.18" fill="none" />
              </svg>

              <div className="relative flex items-start justify-between gap-3">
                <p className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-night-ink/75">
                  <ModelGlyph id={m.id} family={m.family} size={16} className="text-forecast" />
                  Google · foundation model
                </p>
                <span className="flex items-center gap-2">
                  <ModeChip m={m} night />
                  {active && (
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-forecast text-white">
                      <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                </span>
              </div>
              <p className="relative mt-3 font-display text-[30px] leading-[1.05] tracking-[-0.01em]">
                {m.name}
              </p>
              <p className="relative mt-2 max-w-[44ch] text-[13.5px] leading-snug text-night-ink/80">{disabled ? m.reason : m.blurb}</p>
              <div className="relative mt-4 flex flex-wrap gap-1.5">
                <Chip tone="night">
                  <SpeedIcon speed={m.speed} />
                  {speedLabel(m.speed)}
                </Chip>
                <SkillChip skill={row?.skill} rank={row?.rank} champion={champion} night />
                <Chip tone="night">Zero-shot · no per-item training</Chip>
              </div>
            </button>
          );
        }

        return (
          <button
            key={m.id}
            type="button"
            {...common}
            className={cx(
              'group relative flex flex-col rounded-tile border p-4 text-left transition-[transform,background-color,border-color,box-shadow] duration-300 ease-spring',
              active
                ? 'border-forecast bg-forecast-soft/60 shadow-[0_0_0_1px_var(--color-forecast)]'
                : 'border-line bg-surface hover:-translate-y-0.5 hover:border-line-2 hover:shadow-card',
              disabled && 'cursor-not-allowed bg-surface-2 opacity-70 hover:translate-y-0 hover:shadow-none',
              FOCUS,
            )}
          >
            <div className="flex items-start gap-3">
              <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-[11px]', active ? 'bg-forecast text-white' : 'bg-well text-ink')}>
                <ModelGlyph id={m.id} family={m.family} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold leading-tight text-ink">{m.name}</span>
                <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{m.family}</span>
              </span>
              {active && <Check aria-hidden className="h-4 w-4 shrink-0 text-forecast" strokeWidth={3} />}
            </div>
            <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-snug text-muted">{disabled ? (m.reason ?? 'Not available on this server.') : m.blurb}</p>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
              {!disabled && (
                <Chip>
                  <SpeedIcon speed={m.speed} />
                  {speedLabel(m.speed)}
                </Chip>
              )}
              <SkillChip skill={row?.skill} rank={row?.rank} champion={champion} />
              <ModeChip m={m} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default memo(ModelPicker);

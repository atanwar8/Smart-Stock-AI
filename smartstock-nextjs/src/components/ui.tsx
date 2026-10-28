'use client';

import { ArrowDownRight, ArrowUpRight, ChevronDown, Loader2, Minus, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

/* ---------- Layout ---------- */

export function PageHeader({
  crumb,
  title,
  summary,
  actions,
}: {
  crumb: ReactNode;
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="mb-1.5 text-[12.5px] text-faint">{crumb}</div>
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[36px]">{title}</h1>
        {summary && <p className="mt-1.5 max-w-[68ch] text-[14px] text-muted [&_b]:font-semibold [&_b]:text-ink">{summary}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cx('min-w-0 rounded-card border border-line/60 bg-surface shadow-card', className)}>{children}</section>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/* ---------- Controls ---------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-well p-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cx(
              'rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors',
              active ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(20_34_30/0.12)]' : 'text-muted hover:text-ink'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'harvest';

export function Button({
  variant = 'secondary',
  icon: Icon,
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: LucideIcon; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        variant === 'primary' && 'bg-primary text-on-primary shadow-[0_8px_18px_-10px_rgb(11_107_95/0.7)] hover:bg-primary-hover',
        variant === 'secondary' && 'border border-line-2 bg-surface text-ink hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-well hover:text-ink',
        variant === 'harvest' && 'bg-harvest text-harvest-ink hover:bg-[#f0c463]',
        className
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" strokeWidth={2} />}
      {children}
    </button>
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cx('relative', className)}>
      <select
        {...props}
        className="h-9 w-full appearance-none rounded-full border border-line-2 bg-surface pl-3.5 pr-9 text-[13px] font-semibold text-ink hover:bg-surface-2"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
    </div>
  );
}

export function Field({ label, hint, suffix, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; suffix?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-ink">{label}</span>
      <span className="relative block">
        <input
          {...props}
          className="h-11 w-full rounded-tile border border-line-2 bg-surface px-3.5 text-[14px] text-ink placeholder:text-faint/80 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/12"
        />
        {suffix && <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12.5px] text-faint">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span>
        <span className="block text-[13.5px] font-semibold text-ink">{label}</span>
        {description && <span className="block text-[12.5px] text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-line-2')}
      >
        <span
          className={cx(
            'absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          )}
        />
      </button>
    </label>
  );
}

/* ---------- Data display ---------- */

export type Tone = 'good' | 'bad' | 'warn' | 'info' | 'neutral';

const TONE: Record<Tone, string> = {
  good: 'bg-good/10 text-good',
  bad: 'bg-bad/10 text-bad',
  warn: 'bg-warn/12 text-warn',
  info: 'bg-info/10 text-info',
  neutral: 'bg-well text-muted',
};

const DOT: Record<Tone, string> = {
  good: 'bg-good',
  bad: 'bg-bad',
  warn: 'bg-[#d99a1e]',
  info: 'bg-info',
  neutral: 'bg-faint',
};

export function Pill({ tone = 'neutral', dot = true, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold', TONE[tone])}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', DOT[tone])} />}
      {children}
    </span>
  );
}

// Inventory statuses from the API ("critical" / "high" / "good" / "opportunity", or red/yellow/green/blue)
export const statusTone = (status: string): Tone => {
  const s = status.toLowerCase();
  if (s === 'critical' || s === 'red') return 'bad';
  if (s === 'high' || s === 'yellow' || s === 'warning') return 'warn';
  if (s === 'good' || s === 'green' || s === 'success') return 'good';
  if (s === 'opportunity' || s === 'blue' || s === 'info') return 'info';
  return 'neutral';
};

export const statusLabel = (status: string) => {
  const s = status.toLowerCase();
  if (s === 'high') return 'Low stock';
  if (s === 'opportunity') return 'Stock up';
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// A change chip: up/down arrow, tinted by whether the move is good for the restaurant.
// For prices, a rise is bad, so pass `upIsGood={false}`.
export function Delta({ value, suffix = '%', upIsGood = true }: { value: number; suffix?: string; upIsGood?: boolean }) {
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  const tone: Tone = flat ? 'neutral' : up === upIsGood ? 'good' : 'bad';
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx('tabular inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[12px] font-semibold', TONE[tone])}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
      {flat ? '0' : `${up ? '+' : ''}${value.toFixed(1)}`}
      {suffix}
    </span>
  );
}

export function Meter({ value, tone = 'good', label }: { value: number; tone?: Tone; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-well" role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-[width] duration-500', DOT[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Soft tinted tile with the produce's initials, used wherever a commodity is listed
const TILE_TINTS = ['bg-[#e3efe9] text-[#0b6b5f]', 'bg-[#f3ead7] text-[#8a5a12]', 'bg-[#e6ecf7] text-[#2a5fc4]', 'bg-[#f6e4e0] text-[#ab311f]', 'bg-[#ebe8f4] text-[#5b4bb0]', 'bg-[#e8efdc] text-[#4c7a1e]'];

export function ProduceTile({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const words = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
  const tint = TILE_TINTS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % TILE_TINTS.length];
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-[10px] font-bold',
        size === 'md' ? 'h-9 w-9 text-[12px]' : 'h-7 w-7 text-[10.5px]',
        tint
      )}
    >
      {initials}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-tile bg-well', className)} />;
}

export function Empty({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-well text-muted">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-[42ch] text-[13px] text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Open-Meteo's data is CC BY 4.0, so every live weather view credits it
export function WeatherCredit() {
  return (
    <p className="mt-4 text-[11.5px] text-faint">
      Weather data by{' '}
      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-2 hover:text-ink">
        Open-Meteo.com
      </a>
    </p>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-tile bg-bad/8 px-3.5 py-2.5 text-[13px] text-bad">{children}</p>;
}

export const money = (n: number, digits = 2) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });

export { cx };

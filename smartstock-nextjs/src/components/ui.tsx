'use client';

import { ArrowDownRight, ArrowUpRight, ChevronDown, Loader2, Minus, type LucideIcon } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import ProduceIcon from './produce/ProduceIcon';

// Shared primitives for every page and the Forecast Studio (which reads but does not edit this file).
// Export names and props are kept source-compatible; new options are optional.

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
    <div className="mb-7 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 text-[12.5px] text-faint">{crumb}</div>
        <h1 className="font-display text-[40px] leading-[1.02] tracking-[-0.012em] text-ink sm:text-[52px]">{title}</h1>
        {summary && (
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted [&_b]:font-semibold [&_b]:text-ink">{summary}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type CardTone = 'paper' | 'night';

export function Card({
  className,
  children,
  tone = 'paper',
  style,
  label,
}: {
  className?: string;
  children: ReactNode;
  /** "night" is the one dark hero card a page may have */
  tone?: CardTone;
  style?: CSSProperties;
  /** Accessible name for the region */
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      style={style}
      className={cx(
        'relative min-w-0 rounded-card',
        tone === 'paper' && 'border border-line bg-surface shadow-card',
        tone === 'night' && 'overflow-hidden bg-night text-night-ink shadow-[var(--shadow-night)]',
        className
      )}
    >
      {children}
    </section>
  );
}

export function NightCard(props: { className?: string; children: ReactNode; style?: CSSProperties; label?: string }) {
  return <Card {...props} tone="night" />;
}

export function CardHeader({ title, subtitle, action, night = false }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; night?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
      <div className="min-w-0">
        <h2 className={cx('text-[15px] font-semibold tracking-[-0.01em]', night ? 'text-white' : 'text-ink')}>{title}</h2>
        {subtitle && <p className={cx('mt-0.5 text-[13px] leading-snug', night ? 'text-night-ink/65' : 'text-muted')}>{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** Mono marginal note: units, axis names, small counts */
export function Micro({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('micro', className)}>{children}</span>;
}

/* ---------- Controls ---------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  night = false,
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  night?: boolean;
}) {
  // Arrow keys move the selection, like a native radio group
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
    onChange(next.value);
    (e.currentTarget.querySelector(`[data-value="${CSS.escape(next.value)}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx('inline-flex shrink-0 rounded-full p-[3px]', night ? 'bg-white/[0.08]' : 'bg-well')}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-value={opt.value}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cx(
              'whitespace-nowrap rounded-full font-semibold transition-[background-color,color,box-shadow] duration-200 ease-spring',
              size === 'sm' ? 'px-2.5 py-[3px] text-[12px]' : 'px-3.5 py-1 text-[12.5px]',
              active
                ? night
                  ? 'bg-white/[0.16] text-white'
                  : 'bg-surface text-ink shadow-[0_1px_2px_rgb(28_33_30/0.1),0_2px_8px_-2px_rgb(28_33_30/0.08)]'
                : night
                ? 'text-night-ink/60 hover:text-white'
                : 'text-muted hover:text-ink'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'harvest' | 'night' | 'forecast';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: LucideIcon; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,box-shadow,transform] duration-200 ease-spring active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        size === 'md' ? 'h-10 px-4 text-[13.5px]' : 'h-8 px-3 text-[12.5px]',
        variant === 'primary' && 'bg-accent text-accent-ink shadow-[0_8px_18px_-10px_rgb(46_106_78/0.8)] hover:bg-[#25573f]',
        variant === 'secondary' && 'border border-line-2 bg-surface text-ink hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-well hover:text-ink',
        variant === 'forecast' && 'bg-forecast text-white shadow-[0_8px_18px_-10px_rgb(91_91_214/0.9)] hover:bg-[#4b4bc4]',
        // On the night card: a bright pill ("harvest" kept as an alias for older markup)
        (variant === 'night' || variant === 'harvest') && 'bg-white text-night hover:bg-night-ink',
        className
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" strokeWidth={2} />}
      {children}
    </button>
  );
}

/** Small round icon-only button; `label` is required because there is no visible text */
export function IconButton({
  icon: Icon,
  label,
  night = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; night?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200',
        night ? 'bg-white/[0.08] text-night-ink hover:bg-white/[0.16]' : 'border border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink',
        className
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
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
          className="tabular h-11 w-full rounded-tile border border-line-2 bg-surface-2/60 px-3.5 text-[15px] text-ink transition-[border-color,box-shadow,background-color] placeholder:text-faint/80 focus:border-accent/60 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-accent/10"
        />
        {suffix && <span className="micro pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-faint">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
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
        className={cx('relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-300 ease-spring', checked ? 'bg-accent' : 'bg-line-2')}
      >
        <span
          className={cx(
            'absolute left-0 top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.18)] transition-transform duration-300 ease-bounce',
            checked ? 'translate-x-[20px]' : 'translate-x-[2px]'
          )}
        />
      </button>
    </div>
  );
}

export function Kbd({ children, night = false }: { children: ReactNode; night?: boolean }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] px-1 font-mono text-[10.5px] font-medium',
        night ? 'bg-white/10 text-night-ink/80' : 'border border-line-2 bg-surface text-muted shadow-[0_1px_0_rgb(28_33_30/0.08)]'
      )}
    >
      {children}
    </kbd>
  );
}

/* ---------- Data display ---------- */

export type Tone = 'good' | 'bad' | 'warn' | 'info' | 'neutral' | 'forecast';

const TONE: Record<Tone, string> = {
  good: 'bg-good/10 text-good',
  bad: 'bg-bad/10 text-bad',
  warn: 'bg-[#d99a1e]/14 text-warn',
  info: 'bg-info/10 text-info',
  neutral: 'bg-well text-muted',
  forecast: 'bg-forecast-soft text-forecast',
};

const DOT: Record<Tone, string> = {
  good: 'bg-good',
  bad: 'bg-bad',
  warn: 'bg-[#d99a1e]',
  info: 'bg-info',
  neutral: 'bg-faint',
  forecast: 'bg-forecast',
};

export function Pill({ tone = 'neutral', dot = true, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold', TONE[tone])}>
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
export function Delta({ value, suffix = '%', upIsGood = true, night = false }: { value: number; suffix?: string; upIsGood?: boolean; night?: boolean }) {
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  const tone: Tone = flat ? 'neutral' : up === upIsGood ? 'good' : 'bad';
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const nightTone = flat ? 'bg-white/10 text-night-ink/80' : up === upIsGood ? 'bg-[#4ade80]/15 text-[#86efac]' : 'bg-[#fb7185]/15 text-[#fda4af]';
  return (
    <span className={cx('tabular inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] font-semibold', night ? nightTone : TONE[tone])}>
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
      <div className={cx('h-full rounded-full transition-[width] duration-700 ease-spring', DOT[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A labelled number: small label, display value, optional note */
export function Stat({ label, value, note, className, night = false }: { label: ReactNode; value: ReactNode; note?: ReactNode; className?: string; night?: boolean }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className={cx('micro', night ? 'text-night-ink/55' : 'text-faint')}>{label}</div>
      <div className={cx('tabular mt-1 font-display text-[28px] leading-none', night ? 'text-white' : 'text-ink')}>{value}</div>
      {note && <div className={cx('mt-1.5 text-[12px]', night ? 'text-night-ink/60' : 'text-faint')}>{note}</div>}
    </div>
  );
}

// Older markup lists produce with this; it now draws the produce symbol in its tinted bubble
export function ProduceTile({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return <ProduceIcon commodity={name} bubble size={size === 'md' ? 36 : 28} decorative />;
}

/** Counts smoothly from the previous value to the new one; instant under reduced motion */
export function Ticker({ value, format, duration = 650 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      setShown(start + (value - start) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="tabular">{format(shown)}</span>;
}

export function Skeleton({ className, night = false }: { className?: string; night?: boolean }) {
  return <div aria-hidden="true" className={cx('rounded-tile', night ? 'shimmer-night' : 'shimmer', className)} />;
}

/** Placeholder shaped like a card: header line, subtitle, and a body block */
export function SkeletonCard({ className, bodyClassName = 'h-40', night = false }: { className?: string; bodyClassName?: string; night?: boolean }) {
  return (
    <Card tone={night ? 'night' : 'paper'} className={cx('p-5 sm:p-6', className)}>
      <div role="status" aria-label="Loading" className="space-y-3">
        <Skeleton night={night} className="h-4 w-40 rounded-full" />
        <Skeleton night={night} className="h-3 w-64 max-w-full rounded-full" />
        <Skeleton night={night} className={cx('mt-4', bodyClassName)} />
      </div>
    </Card>
  );
}

export function Empty({ icon: Icon, title, body, action, night = false }: { icon: LucideIcon; title: string; body?: string; action?: ReactNode; night?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className={cx('mb-3 flex h-12 w-12 items-center justify-center rounded-full', night ? 'bg-white/[0.08] text-night-ink/70' : 'bg-well text-muted')}>
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <p className={cx('font-display text-[22px] leading-tight', night ? 'text-white' : 'text-ink')}>{title}</p>
      {body && <p className={cx('mt-1.5 max-w-[42ch] text-[13px]', night ? 'text-night-ink/65' : 'text-muted')}>{body}</p>}
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
  return (
    <p role="alert" className="rounded-tile bg-bad/[0.07] px-3.5 py-2.5 text-[13px] text-bad">
      {children}
    </p>
  );
}

export const money = (n: number, digits = 2) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });

export { cx };

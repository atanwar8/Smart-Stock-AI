'use client';

// The handful of building blocks the studio needs. Deliberately local (not ui.tsx, which is being rewritten)
// and styled only with the shared SPEC §3 token utilities.

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './format';
import s from './studio.module.css';

export const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forecast focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cx('rounded-card border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </section>
  );
}

export function Eyebrow({ className, children, as: Tag = 'p' }: { className?: string; children: ReactNode; as?: 'p' | 'span' | 'h2' | 'h3' }) {
  return <Tag className={cx('font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted', className)}>{children}</Tag>;
}

export function PanelHeader({ eyebrow, title, action, id }: { eyebrow?: ReactNode; title: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 id={id} className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

export type ChipTone = 'neutral' | 'forecast' | 'accent' | 'good' | 'bad' | 'warn' | 'night';

const CHIP: Record<ChipTone, string> = {
  neutral: 'bg-well text-muted',
  forecast: 'bg-forecast-soft text-forecast',
  accent: 'bg-accent/12 text-accent',
  good: 'bg-good/10 text-good',
  bad: 'bg-bad/10 text-bad',
  warn: 'bg-warn/10 text-warn',
  night: 'bg-night-ink/12 text-night-ink',
};

export function Chip({ tone = 'neutral', className, children, title, dot }: { tone?: ChipTone; className?: string; children: ReactNode; title?: string; dot?: boolean }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold leading-5', CHIP[tone], className)}>
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink shadow-[0_1px_0_rgb(255_255_255/0.18)_inset,0_6px_16px_-8px_var(--color-accent)] hover:brightness-110 active:brightness-95',
  secondary: 'border border-line-2 bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-muted hover:bg-well hover:text-ink',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }>(
  function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          'inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition-[background-color,filter,transform,opacity] duration-200 ease-spring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
          size === 'sm' ? 'h-8 px-3 text-[12.5px]' : 'h-10 px-4 text-[13.5px]',
          BUTTON[variant],
          FOCUS,
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx('hidden rounded-[6px] border border-current/25 px-1.5 font-mono text-[10.5px] leading-[18px] opacity-80 sm:inline-block', className)}>
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('rounded-tile', s.skeleton, className)} />;
}

export function Switch({ checked, onChange, label, className }: { checked: boolean; onChange: (next: boolean) => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx('group inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-[12.5px] font-semibold text-muted hover:text-ink', FOCUS, className)}
    >
      <span className={cx('relative h-5 w-9 rounded-full transition-colors duration-200', checked ? 'bg-forecast' : 'bg-line-2')}>
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-300 ease-spring',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </span>
      {label}
    </button>
  );
}

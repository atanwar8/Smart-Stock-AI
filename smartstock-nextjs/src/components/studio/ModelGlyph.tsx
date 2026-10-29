// One tiny line glyph per model family, so a model is recognisable at a glance in cards, bars and chips.

import { memo, type ReactNode } from 'react';

type GlyphKind = 'ensemble' | 'trees' | 'smooth' | 'theta' | 'repeat' | 'arima' | 'line';

export function glyphKind(id: string, family = ''): GlyphKind {
  const text = `${id} ${family}`.toLowerCase();
  if (text.includes('ensemble') || text.includes('blend')) return 'ensemble';
  if (text.includes('lightgbm') || text.includes('xgb') || text.includes('tree') || text.includes('boost')) return 'trees';
  if (text.includes('theta')) return 'theta';
  if (text.includes('naive') || text.includes('baseline')) return 'repeat';
  if (text.includes('ets') || text.includes('smooth')) return 'smooth';
  if (text.includes('arima')) return 'arima';
  return 'line';
}

const SHAPES: Record<GlyphKind, ReactNode> = {
  ensemble: (
    <>
      <circle cx="7.4" cy="8" r="4.2" />
      <circle cx="12.6" cy="8" r="4.2" />
      <circle cx="10" cy="12.6" r="4.2" />
    </>
  ),
  trees: (
    <>
      <path d="M10 4.6 5.6 10M10 4.6l4.4 5.4M5.6 10l-2 5.4M5.6 10l2 5.4" />
      <circle cx="10" cy="3.6" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="5.6" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="3.6" cy="16" r="1.3" />
      <circle cx="7.6" cy="16" r="1.3" />
    </>
  ),
  smooth: <path d="M2.6 15.4c3.2 0 4-9 8.2-9 3 0 4.2 2.4 6.6 2.4" />,
  theta: (
    <>
      <ellipse cx="10" cy="10" rx="5" ry="7.2" />
      <path d="M5 10h10" />
    </>
  ),
  repeat: (
    <>
      <path d="M2.6 12.6c1.6-5 3.4-5 5 0" />
      <path d="M10.4 12.6c1.6-5 3.4-5 5 0" strokeDasharray="1.6 2" />
      <path d="M2.6 16h14.8" opacity="0.45" />
    </>
  ),
  arima: <path d="M2.6 13 6 9l3 3.2 3.4-6.2 2.4 4 2.2-2" />,
  line: <path d="M2.6 14.6 7.4 9.6l3.4 2.6 6.6-7" />,
};

export const ModelGlyph = memo(function ModelGlyph({ id, family, size = 18, className }: { id: string; family?: string; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {SHAPES[glyphKind(id, family)]}
    </svg>
  );
});

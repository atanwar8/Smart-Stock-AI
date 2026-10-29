'use client';

import type { ReactNode } from 'react';

// Hand-drawn produce symbols. The UI shows these instead of commodity names (SPEC §4).
// Exported names and props are a contract shared with the Forecast Studio; keep them stable.
// Idle animations live in globals.css (".produce-sym.is-animated [data-part=...]"), one personality per symbol,
// and are switched off by the global prefers-reduced-motion rule.

export type ProduceKey =
  | 'tomato'
  | 'lettuce'
  | 'carrot'
  | 'broccoli'
  | 'cucumber'
  | 'cauliflower'
  | 'cabbage'
  | 'asparagus'
  | 'sweet-potato'
  | 'green-onion'
  | 'bell-pepper'
  | 'unknown';

export interface ProduceMeta {
  key: ProduceKey;
  /** Short human name, used for aria-label and tooltips (the UI shows the symbol, not the name) */
  label: string;
  /** Signature color of the symbol, for halos, chart lines and chips */
  tint: string;
}

export const PRODUCE: Record<ProduceKey, ProduceMeta> = {
  tomato: { key: 'tomato', label: 'Tomatoes', tint: '#E5533D' },
  lettuce: { key: 'lettuce', label: 'Lettuce', tint: '#7DBA4C' },
  carrot: { key: 'carrot', label: 'Carrots', tint: '#F08A24' },
  broccoli: { key: 'broccoli', label: 'Broccoli', tint: '#3E8E4E' },
  cucumber: { key: 'cucumber', label: 'Cucumbers', tint: '#4E9A5B' },
  cauliflower: { key: 'cauliflower', label: 'Cauliflower', tint: '#D9CBA3' },
  cabbage: { key: 'cabbage', label: 'Cabbage', tint: '#9CC77B' },
  asparagus: { key: 'asparagus', label: 'Asparagus', tint: '#6E9F3F' },
  'sweet-potato': { key: 'sweet-potato', label: 'Sweet potatoes', tint: '#C2643B' },
  'green-onion': { key: 'green-onion', label: 'Green onions', tint: '#58A65C' },
  'bell-pepper': { key: 'bell-pepper', label: 'Bell peppers', tint: '#D93A2B' },
  unknown: { key: 'unknown', label: 'Produce', tint: '#8A8F87' },
};

/** Maps any USDA or app commodity name ("Onions, Green", "Onions (Green)", "Peppers (Bell Type)", "Peppers") to a symbol */
export function produceKey(commodity: string): ProduceKey {
  const c = commodity.toLowerCase();
  if (c.includes('tomat')) return 'tomato';
  if (c.includes('lettuce')) return 'lettuce';
  if (c.includes('carrot')) return 'carrot';
  if (c.includes('broccoli')) return 'broccoli';
  if (c.includes('cucumber')) return 'cucumber';
  if (c.includes('cauliflower')) return 'cauliflower';
  if (c.includes('cabbage')) return 'cabbage';
  if (c.includes('asparagus')) return 'asparagus';
  if (c.includes('sweet potato')) return 'sweet-potato';
  if (c.includes('onion')) return 'green-onion';
  if (c.includes('pepper')) return 'bell-pepper';
  return 'unknown';
}

export const produceMeta = (commodity: string): ProduceMeta => PRODUCE[produceKey(commodity)];

/** The symbol's tint as rgba, for halos and soft fills */
export const tintAlpha = (hex: string, alpha: number) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

const HI = { fill: '#fff', opacity: 0.42 };
const round = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

// 24x24 drawings: 2-4 flat shapes and one highlight each. data-part names the piece that moves.
const DRAWINGS: Record<ProduceKey, ReactNode> = {
  tomato: (
    <>
      <g data-part="tomato">
        <ellipse cx="12" cy="13.8" rx="8.4" ry="7.4" fill="#E5533D" />
        <path d="M3.9 14.9c.8 3.7 4 6.3 8.1 6.3s7.3-2.6 8.1-6.3c-1.7 2.4-4.7 3.9-8.1 3.9s-6.4-1.5-8.1-3.9z" fill="#C93F2C" />
        <ellipse cx="8.2" cy="11.6" rx="1.5" ry="2.4" transform="rotate(-28 8.2 11.6)" {...HI} />
        <path
          d="M12 6.4c-1.4-1-3.4-.9-4.6.2 1.5.1 2.7.8 3.5 1.8-.6.8-.8 1.7-.6 2.6.7-.8 1.3-1.7 1.7-2.5.4.8 1 1.7 1.7 2.5.2-.9 0-1.8-.6-2.6.8-1 2-1.7 3.5-1.8-1.2-1.1-3.2-1.2-4.6-.2z"
          fill="#4E9A5B"
        />
        <path d="M12 6.6V3.8" stroke="#3E7D45" strokeWidth="1.6" {...round} />
      </g>
    </>
  ),
  lettuce: (
    <>
      <path
        data-part="leaf-1"
        d="M12 21c-4.8 0-8.3-3-8.3-7.2 0-2 .8-3.2 2-3.9-.2-1.8.9-3.4 2.6-3.7.7-1.4 2.2-2.2 3.7-2.2s3 .8 3.7 2.2c1.7.3 2.8 1.9 2.6 3.7 1.2.7 2 1.9 2 3.9 0 4.2-3.5 7.2-8.3 7.2z"
        fill="#9ACB6B"
      />
      <ellipse cx="7.4" cy="10.6" rx="1.2" ry="2" transform="rotate(-35 7.4 10.6)" {...HI} />
      <g data-part="leaf-2">
        <path d="M12 20.2c-2.9 0-5-2.1-5-5.2 0-2.6 1.6-4.8 3.2-6 .5.9 1.1 1.4 1.8 1.4s1.3-.5 1.8-1.4c1.6 1.2 3.2 3.4 3.2 6 0 3.1-2.1 5.2-5 5.2z" fill="#6DAA3E" />
        <path d="M12 19.4v-7.6M12 15.6l-2-1.6M12 13.6l1.8-1.4" stroke="#E4F2D2" strokeWidth="1" {...round} />
      </g>
    </>
  ),
  carrot: (
    <>
      <g data-part="carrot-top">
        <path d="M16.3 7.9c-.5-2 .1-3.9 1.5-5.1.4 1.8-.1 3.7-1.5 5.1z" fill="#5FA84E" />
        <path d="M16.7 8.3c1-1.8 2.7-2.8 4.6-2.8-.7 1.8-2.5 2.9-4.6 2.8z" fill="#4E9A45" />
        <path d="M15.9 8c-1.1-1.4-2.8-2.1-4.5-1.8 1 1.3 2.7 2 4.5 1.8z" fill="#6DB45A" />
      </g>
      <g data-part="carrot">
        <path d="M17.6 8.8c-1.2-1.5-3.3-1.7-4.7-.5l-7.3 6.9c-1.3 1.3-2.1 3.1-2.2 4.9 0 .3.2.5.5.5 1.8-.1 3.6-.9 4.9-2.2l6.9-7.3c1.2-1.3 1.9-2.3 1.9-2.3z" fill="#F08A24" />
        <path d="M9.4 12.6l1.5 1.3M7.1 15l1.3 1.1M11.9 10.4l1.1 1" stroke="#CF6D10" strokeWidth="1" {...round} />
        <path d="M12.5 9.7l-5.4 5" stroke="#fff" strokeOpacity=".42" strokeWidth="1.1" {...round} />
      </g>
    </>
  ),
  broccoli: (
    <>
      <path d="M10 13.4h4l.9 6.3c.1.7-.4 1.3-1.1 1.3h-3.6c-.7 0-1.2-.6-1.1-1.3z" fill="#A6CF84" />
      <path d="M12 15v4.2M10.9 16.2l1.1 1.1 1.1-1.1" stroke="#86B565" strokeWidth=".9" {...round} />
      <g data-part="florets">
        <circle cx="7.9" cy="10.6" r="3.6" fill="#3E8E4E" />
        <circle cx="16.1" cy="10.6" r="3.6" fill="#3E8E4E" />
        <circle cx="12" cy="7.6" r="4.3" fill="#47995A" />
        <circle cx="12" cy="12" r="3.2" fill="#3A8549" />
        <circle cx="9" cy="12" r=".7" fill="#2E7040" />
        <circle cx="14.6" cy="9" r=".7" fill="#2E7040" />
        <circle cx="16.8" cy="12" r=".6" fill="#2E7040" />
        <circle cx="10.4" cy="6.2" r="1.2" {...HI} />
      </g>
    </>
  ),
  cucumber: (
    <g data-part="cucumber">
      <g transform="rotate(-35 12 12)">
        <rect x="2.8" y="8.6" width="18.4" height="6.8" rx="3.4" fill="#4E9A5B" />
        <path d="M6 12.9h11.6" stroke="#7DBF7A" strokeWidth=".9" strokeOpacity=".8" {...round} />
        <circle cx="20" cy="12" r=".9" fill="#3D7F49" />
        <circle cx="8.4" cy="11.4" r=".45" fill="#D6EDCE" />
        <circle cx="12.2" cy="14" r=".45" fill="#D6EDCE" />
        <circle cx="15" cy="11.2" r=".45" fill="#D6EDCE" />
        <circle cx="17.6" cy="13.8" r=".45" fill="#D6EDCE" />
        <path d="M6.4 10.4h7.6" stroke="#fff" strokeOpacity=".42" strokeWidth="1.1" {...round} />
      </g>
    </g>
  ),
  cauliflower: (
    <>
      <path d="M3.4 12.8c1.9-.6 4.8.3 6.8 2.8l-1.2 4.6c-3-.8-5.2-3.8-5.6-7.4z" fill="#6E9F3F" />
      <path d="M20.6 12.8c-1.9-.6-4.8.3-6.8 2.8l1.2 4.6c3-.8 5.2-3.8 5.6-7.4z" fill="#6E9F3F" />
      <g data-part="curds">
        <circle cx="8.5" cy="11.2" r="3.2" fill="#EFE5C8" />
        <circle cx="15.5" cy="11.2" r="3.2" fill="#EFE5C8" />
        <circle cx="12" cy="9" r="3.7" fill="#F5EED8" />
        <circle cx="10.1" cy="13.7" r="3" fill="#EADFBE" />
        <circle cx="13.9" cy="13.7" r="3" fill="#EADFBE" />
        <circle cx="10.3" cy="10.6" r=".55" fill="#D3C49A" />
        <circle cx="14.2" cy="12.4" r=".55" fill="#D3C49A" />
        <circle cx="12.2" cy="14.8" r=".55" fill="#D3C49A" />
        <circle cx="10.6" cy="7.6" r="1.1" fill="#fff" opacity=".8" />
      </g>
      <path d="M8.4 19.6c1-1.7 2.2-2.5 3.6-2.5s2.6.8 3.6 2.5c-1 .9-2.2 1.3-3.6 1.3s-2.6-.4-3.6-1.3z" fill="#5C8E33" />
    </>
  ),
  cabbage: (
    <g data-part="cabbage">
      <circle cx="12" cy="12.6" r="8.3" fill="#A9D18A" />
      <path d="M3.8 13.6c.6 4 4 7.3 8.2 7.3-3.3-.9-5.9-3.7-6.5-7.4-.6-.4-1.1-.3-1.7.1z" fill="#86B866" />
      <path d="M12 4.6c3.2 2 4.7 5.3 4.4 8.6-.3 3.4-2.2 6.3-4.4 7.6" stroke="#79AC59" strokeWidth="1.15" {...round} />
      <path d="M12 20.8c-2.6-1.8-4-4.6-4-7.6 0-2.6 1.1-5 3-6.8" stroke="#79AC59" strokeWidth="1.15" {...round} />
      <path d="M12.4 12.2c1.4-.2 2.7.2 3.8 1.1M11.6 15.2c-1.3-.1-2.5.3-3.4 1.1" stroke="#8FBF70" strokeWidth=".9" {...round} />
      <ellipse cx="8.4" cy="8.6" rx="1.3" ry="2" transform="rotate(35 8.4 8.6)" {...HI} />
    </g>
  ),
  asparagus: (
    <>
      <g data-part="spear-1">
        <path d="M8.4 21L9.5 7.6" stroke="#7FAF4A" strokeWidth="2.5" {...round} />
        <path d="M9.6 3.9c-1 .9-1.5 2.3-1.3 3.7l1.2.4 1.2-.2c.2-1.5-.2-3-1.1-3.9z" fill="#5E8C33" />
        <path d="M8.6 12.4l.8-.6M8.4 16l.8-.6" stroke="#5E8C33" strokeWidth=".8" {...round} />
      </g>
      <g data-part="spear-3">
        <path d="M15.6 21L14.5 7.6" stroke="#7FAF4A" strokeWidth="2.5" {...round} />
        <path d="M14.4 3.9c1 .9 1.5 2.3 1.3 3.7l-1.2.4-1.2-.2c-.2-1.5.2-3 1.1-3.9z" fill="#5E8C33" />
        <path d="M15.4 12.4l-.8-.6M15.6 16l-.8-.6" stroke="#5E8C33" strokeWidth=".8" {...round} />
      </g>
      <g data-part="spear-2">
        <path d="M12 21.2V5.4" stroke="#8FBE57" strokeWidth="2.7" {...round} />
        <path d="M12 1.9c-1 1-1.5 2.4-1.3 3.9l1.3.4 1.3-.4c.2-1.5-.3-2.9-1.3-3.9z" fill="#6E9F3F" />
        <path d="M11.4 7.6v4" stroke="#fff" strokeOpacity=".5" strokeWidth=".9" {...round} />
        <path d="M12.4 10.6l.7-.6M11.6 14.2l-.7-.6" stroke="#5E8C33" strokeWidth=".8" {...round} />
      </g>
      <rect x="7.4" y="15.4" width="9.2" height="2.3" rx="1.15" fill="#C98B5A" />
    </>
  ),
  'sweet-potato': (
    <g data-part="sweet-potato">
      <path d="M2.6 16.4c.6.1 1.1 0 1.6-.3M20.2 9.4c.6-.4 1-1 1.2-1.7" stroke="#A04E2C" strokeWidth="1" {...round} />
      <path d="M4.4 15.6c-1-2.3.3-5 3.2-6.4 3.1-1.5 6.7-2.7 9.6-1.9 2.4.6 3.6 2.6 2.7 4.6-1 2.2-3.8 3.8-7 4.8-3.7 1.1-7.4 1.2-8.5-1.1z" fill="#C2643B" />
      <path d="M5.2 16.2c1.6 1 4.4.9 7.3 0 3-.9 5.6-2.4 6.9-4.4-.6 2.6-3.6 4.6-6.9 5.6-3.1.9-6 .8-7.3-1.2z" fill="#A9532F" />
      <ellipse cx="9.2" cy="12.4" rx=".7" ry=".4" fill="#8E4222" />
      <ellipse cx="13.6" cy="11" rx=".7" ry=".4" fill="#8E4222" />
      <ellipse cx="16.2" cy="12.6" rx=".6" ry=".35" fill="#8E4222" />
      <path d="M7.4 11c2.2-1.4 4.8-2.3 7.2-2.5" stroke="#fff" strokeOpacity=".42" strokeWidth="1.1" {...round} />
    </g>
  ),
  'green-onion': (
    <>
      <path data-part="stalk-1" d="M10.8 14.4C10.4 10.4 9 6.8 6.6 4" stroke="#6DB86A" strokeWidth="2" {...round} />
      <path data-part="stalk-3" d="M13.2 14.4c.6-3.4 2.2-6.4 4.4-8.6" stroke="#58A65C" strokeWidth="2" {...round} />
      <g data-part="stalk-2">
        <path d="M12 14.4c0-4.4.4-8 1.2-11.4" stroke="#4C9A50" strokeWidth="2.2" {...round} />
        <path d="M12.4 9.6c.1-1.6.3-3.1.6-4.5" stroke="#fff" strokeOpacity=".45" strokeWidth=".8" {...round} />
      </g>
      <path d="M9.6 14h4.8v3.6c0 1.6-1.1 2.8-2.4 2.8s-2.4-1.2-2.4-2.8z" fill="#F4F1E3" stroke="#DCD6BD" strokeWidth=".6" />
      <path d="M9.6 14h4.8v1.5H9.6z" fill="#CFE6B9" />
      <path d="M10.9 20.4l-.8 1.4M12 20.8v1.4M13.1 20.4l.8 1.4" stroke="#BDB394" strokeWidth=".9" {...round} />
    </>
  ),
  'bell-pepper': (
    <g data-part="pepper">
      <path
        d="M12 7.6c-1.4-1-3.6-1.1-5 .2-1.8 1.6-2.2 4.6-1.6 7.6.6 3 2.4 5.6 4.4 5.8.9.1 1.6-.3 2.2-.9.6.6 1.3 1 2.2.9 2-.2 3.8-2.8 4.4-5.8.6-3-.2-6-1.6-7.6-1.4-1.3-3.6-1.2-5-.2z"
        fill="#D93A2B"
      />
      <path d="M9.2 9.2c-.6 3.4-.4 7.4.9 10.6M14.8 9.2c.6 3.4.4 7.4-.9 10.6" stroke="#B42C1F" strokeWidth=".9" {...round} />
      <path d="M7.8 10.6c-.5 1.6-.4 3.4.2 5" stroke="#fff" strokeOpacity=".45" strokeWidth="1.2" {...round} />
      <path d="M9.8 7.8c.6-.8 1.4-1.1 2.2-1.1s1.6.3 2.2 1.1c-.6.5-1.4.7-2.2.7s-1.6-.2-2.2-.7z" fill="#4E9A5B" />
      <path d="M12 7.2c0-1.6.4-3 1.6-4 .8-.6 1.8-.8 2.6-.6" stroke="#3E7D45" strokeWidth="1.8" {...round} />
    </g>
  ),
  unknown: (
    <>
      <g data-part="sprout">
        <path d="M12 20.6v-8.2" stroke="#7D837A" strokeWidth="1.6" {...round} />
        <path d="M12 13.2c-.4-3-2.6-5-6.2-5 0 3.1 2.5 5.2 6.2 5z" fill="#9AA096" />
        <path d="M12 11.6c.2-3.4 2.6-5.8 6.4-5.8-.2 3.4-2.6 5.8-6.4 5.8z" fill="#8A8F87" />
        <path d="M14 9.6c.9-.9 2-1.5 3.2-1.8" stroke="#fff" strokeOpacity=".45" strokeWidth=".9" {...round} />
      </g>
      <path d="M8 20.8h8" stroke="#B7BBB3" strokeWidth="1.4" {...round} />
    </>
  ),
};

export interface ProduceIconProps {
  /** Any commodity name; mapped with produceKey() */
  commodity: string;
  /** Pixel size of the square symbol (default 28) */
  size?: number;
  /** Idle micro-animation (gentle sway/bob); always off under prefers-reduced-motion */
  animated?: boolean;
  /** Draws the symbol in a soft tinted bubble */
  bubble?: boolean;
  className?: string;
  /** Accessible name; defaults to the produce label */
  title?: string;
  /** Hide from assistive tech when the surrounding control already names the produce */
  decorative?: boolean;
}

// The drawings are static elements created once at module load, so a render is just a wrapper span
export function ProduceIcon({ commodity, size = 28, animated = false, bubble = false, className, title, decorative = false }: ProduceIconProps) {
  const meta = produceMeta(commodity);
  const label = title ?? meta.label;
  const glyph = bubble ? Math.round(size * 0.7) : size;
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : label}
      className={['produce-sym', animated && 'is-animated', className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: bubble ? size : undefined,
        background: bubble ? `radial-gradient(circle at 35% 30%, ${tintAlpha(meta.tint, 0.1)}, ${tintAlpha(meta.tint, 0.22)})` : undefined,
        boxShadow: bubble ? `inset 0 0 0 1px ${tintAlpha(meta.tint, 0.18)}` : undefined,
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {DRAWINGS[meta.key]}
      </svg>
    </span>
  );
}

export default ProduceIcon;

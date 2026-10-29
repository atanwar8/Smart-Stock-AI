// Tiny math helpers for the hand-made SVG charts (no chart library in the bundle).

export type Pt = [number, number];

export const linear = (d0: number, d1: number, r0: number, r1: number) => {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
};

/** Pads a [min, max] domain so lines never touch the card edge; a flat series gets a visible band */
export const padDomain = (values: number[], pad = 0.08): [number, number] => {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi - lo < 1e-9) {
    const d = Math.abs(hi) * 0.05 || 1;
    lo -= d;
    hi += d;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
};

/** About `count` round tick values inside [lo, hi] */
export const niceTicks = (lo: number, hi: number, count = 4) => {
  const raw = (hi - lo) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
};

export const toTime = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).getTime();

export const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Smooth line through points that never overshoots between them (monotone cubic, Fritsch-Carlson) */
export function smoothPath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6;
    slope[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  m[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += `C${x0 + h},${y0 + m[i] * h} ${x1 - h},${y1 - m[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

/** Closed band between an upper and a lower series that share x positions */
export function bandPath(upper: Pt[], lower: Pt[]): string {
  if (!upper.length || upper.length !== lower.length) return '';
  const top = smoothPath(upper);
  const bottom = smoothPath([...lower].reverse()).replace(/^M/, 'L');
  return `${top}${bottom}Z`;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

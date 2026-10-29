// Small formatting helpers for the studio. Dates from the API are report weeks ("YYYY-MM-DD"),
// parsed as UTC so a chef in any time zone sees the same week label.

export const MINUS = '−';

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

export const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export function money(v: number, digits = 2) {
  return `${v < 0 ? MINUS : ''}$${Math.abs(v).toFixed(digits)}`;
}

/** "+12%", "−4%", "0%" with a real minus sign */
export function signedPct(v: number, digits = 0) {
  const rounded = Number(v.toFixed(digits));
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(digits)}%`;
}

export const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function parseDay(iso: string) {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
const DAY = fmt({ month: 'short', day: 'numeric' });
const FULL = fmt({ month: 'short', day: 'numeric', year: 'numeric' });
const MONTH_YEAR = fmt({ month: 'short', year: 'numeric' });

export const shortDate = (iso: string) => DAY.format(parseDay(iso));
export const fullDate = (iso: string) => FULL.format(parseDay(iso));
export const monthYear = (iso: string) => MONTH_YEAR.format(parseDay(iso));

/** "per lb" -> "/lb", "each" -> " each" (matches CommodityContext.priceUnit) */
export function unitSuffix(unit: string | undefined) {
  if (!unit) return '';
  return unit === 'each' ? ' each' : `/${unit.replace(/^per /, '')}`;
}

export const weeks = (n: number) => (n === 1 ? '1 week' : `${n} weeks`);

export function relativeTime(iso: string, now = Date.now()) {
  const seconds = (now - Date.parse(iso)) / 1000;
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function addWeeks(iso: string, n: number) {
  return new Date(parseDay(iso) + n * 7 * 86_400_000).toISOString().slice(0, 10);
}

export function speedLabel(speed: string) {
  if (speed === 'fast') return 'Fast';
  if (speed === 'slow') return 'Slow · a few s';
  if (speed === 'medium') return '~1 s';
  return speed;
}

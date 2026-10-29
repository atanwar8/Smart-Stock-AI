// "What's usual" for a short weekly price series: the Atisbo-style band the anomaly views shade
// behind the real line, and the typical week-to-week move a forecast is compared against.

export interface DatedValue {
  date: string;
  value: number;
}

export const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Usual price = median of every week before the latest; the band is a robust spread (median absolute
 * deviation) around a trailing 4-week median, never narrower than 5% of the usual price.
 */
export function usualBand(actual: DatedValue[]) {
  if (actual.length < 4) return null;
  const values = actual.map((p) => p.value);
  const prior = values.slice(0, -1);
  const latest = actual[actual.length - 1];
  const usual = median(prior);
  const mad = median(prior.map((v) => Math.abs(v - usual))) * 1.4826;
  const half = Math.max(mad, usual * 0.05);
  const expected = actual.map((p, i) => {
    const window = values.slice(Math.max(0, i - 4), i);
    const center = window.length ? median(window) : p.value;
    return { date: p.date, lo: center - half, hi: center + half };
  });
  return { latest, usual, half, ratio: latest.value / usual, expected, outside: Math.abs(latest.value - usual) > half };
}

/** Median absolute week-to-week change, in percent (e.g. 2.4 means prices usually move about 2.4% a week) */
export function usualWeeklyMove(actual: DatedValue[]) {
  const moves: number[] = [];
  for (let i = 1; i < actual.length; i++) {
    const prev = actual[i - 1].value;
    if (prev) moves.push(Math.abs((actual[i].value - prev) / prev) * 100);
  }
  return moves.length ? median(moves) : undefined;
}

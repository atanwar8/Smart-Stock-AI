// Projects a simple standing order plan from what is in the walk-in, for the order calendar.
// It is a planning aid, not the backend's recommendation: each tracked item is reordered one day
// before it runs out, then every delivery cycle (its shelf life, capped at a week), sized to cover
// that cycle at today's usage and priced at the item's current forecast price.

import type { InventoryRow } from './types';
import { num } from './weather';

export interface PlannedOrder {
  key: string;
  commodity: string;
  date: string; // YYYY-MM-DD
  qty: number; // lbs
  price?: number; // $ per unit, when known
  spend?: number;
}

const DAY = 86400000;
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function planOrders(rows: InventoryRow[], prices: Record<string, number | undefined>, from: Date, until: Date): PlannedOrder[] {
  const start = startOfDay(from).getTime();
  const end = startOfDay(until).getTime();
  const orders: PlannedOrder[] = [];
  for (const r of rows) {
    const daysLeft = num(r.days_left);
    const usage = num(r.daily_usage);
    const shelf = num(r.shelf_life) || 7;
    if (usage <= 0) continue;
    const cycle = Math.max(2, Math.min(7, Math.round(shelf)));
    const qty = Math.round(usage * cycle);
    const price = prices[r.ingredient];
    for (let t = start + Math.max(0, Math.floor(daysLeft - 1)) * DAY; t <= end; t += cycle * DAY) {
      const date = iso(new Date(t));
      orders.push({ key: `${r.ingredient}|${date}`, commodity: r.ingredient, date, qty, price, spend: price !== undefined ? qty * price : undefined });
    }
  }
  return orders.sort((a, b) => a.date.localeCompare(b.date));
}

/** Weeks of a month as rows of 7 dates (Monday first); days outside the month are null */
export function monthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (Date | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1))];
  while (cells.length % 7) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

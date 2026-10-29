'use client';

// Alerts the chef silenced or marked "not relevant" are hidden on this device only (client-side),
// so the rail badge and the Alerts page agree without a backend change.

const KEY = 'smartstock.alerts.muted';
export const MUTED_EVENT = 'smartstock:alerts-muted';

/** alert id -> epoch ms until which it stays hidden (Infinity for "not relevant") */
export type MutedAlerts = Record<string, number>;

export function readMuted(): MutedAlerts {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number | null>;
    const now = Date.now();
    const live: MutedAlerts = {};
    for (const [id, until] of Object.entries(raw)) {
      // JSON can't hold Infinity, so "forever" is stored as null
      const t = until === null ? Infinity : until;
      if (t > now) live[id] = t;
    }
    return live;
  } catch {
    return {};
  }
}

export function writeMuted(muted: MutedAlerts) {
  try {
    const serialisable = Object.fromEntries(Object.entries(muted).map(([id, t]) => [id, Number.isFinite(t) ? t : null]));
    localStorage.setItem(KEY, JSON.stringify(serialisable));
  } catch {}
  window.dispatchEvent(new Event(MUTED_EVENT));
}

export const isMuted = (muted: MutedAlerts, id: string) => (muted[id] ?? 0) > Date.now();

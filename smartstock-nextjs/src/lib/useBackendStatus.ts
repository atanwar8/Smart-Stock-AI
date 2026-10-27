'use client';

import { useEffect, useState } from 'react';
import { getJSON } from './api';
import type { Health } from './types';

export interface BackendStatus {
  state: 'checking' | 'online' | 'offline';
  health?: Health;
}

// Polls /health so the UI can show whether the API (and its models) are up — useful on
// hosts that sleep idle instances and take a moment to wake.
export function useBackendStatus(intervalMs = 30000): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>({ state: 'checking' });

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const health = await getJSON<Health>('/health');
        if (!cancelled) setStatus({ state: health.forecaster_ready ? 'online' : 'checking', health });
      } catch {
        if (!cancelled) setStatus((prev) => ({ ...prev, state: 'offline' }));
      }
    };

    check();
    const interval = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [intervalMs]);

  return status;
}

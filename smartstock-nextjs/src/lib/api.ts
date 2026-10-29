'use client';

import { useCallback, useEffect, useState } from 'react';

// The backend is served under /api on the same origin in production (FastAPI hosts the built UI).
// In `npm run dev`, next.config.ts proxies /api to the local FastAPI server on :8000.
// Set NEXT_PUBLIC_API_URL only when the API lives on a different host.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/** A non-2xx answer; `status` lets callers treat e.g. 404 or 409 as a state rather than a failure */
export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`${status}: ${detail}`);
    this.name = 'ApiError';
  }
}

export async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: 'no-store', ...init });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = (await response.json()).detail ?? detail;
    } catch {}
    throw new ApiError(response.status, String(detail));
  }
  return response.json() as Promise<T>;
}

export const postJSON = <T>(path: string, body?: unknown) =>
  getJSON<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

interface ApiState<T> {
  data?: T;
  error?: string;
  loading: boolean;
}

// Fetches `path` whenever it changes; keeps the previous data on screen while reloading.
// Pass null to skip the request.
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<ApiState<T>>({ loading: path !== null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    getJSON<T>(path)
      .then((data) => !cancelled && setState({ data, loading: false }))
      .catch((err: Error) => !cancelled && setState((prev) => ({ ...prev, loading: false, error: err.message })));
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export const qs = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbort } from '../api/http';

export interface AsyncState<T> {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Last successful value, kept while reloading so the UI holds its frame. */
  data?: T;
  error?: string;
}

interface Settled<T> extends AsyncState<T> {
  key: string;
  attempt: number;
}

/**
 * Runs `fn` whenever `key` changes (null disables it). Earlier requests are
 * aborted so a slow response never overwrites a newer one. The loading state
 * is derived: a result only counts once it matches the current key.
 */
export function useAsync<T>(key: string | null, fn: (signal: AbortSignal) => Promise<T>): AsyncState<T> & { retry: () => void } {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    fnRef.current(controller.signal).then(
      (data) => setSettled({ key, attempt, status: 'success', data }),
      (err: unknown) => {
        if (isAbort(err)) return;
        const error = err instanceof Error ? err.message : String(err);
        setSettled((s) => ({ key, attempt, status: 'error', error, data: s?.data }));
      },
    );
    return () => controller.abort();
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  if (key === null) return { status: 'idle', retry };
  if (!settled || settled.key !== key || settled.attempt !== attempt) {
    return { status: 'loading', data: settled?.data, retry };
  }
  return { status: settled.status, data: settled.data, error: settled.error, retry };
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface FetchJsonOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Fetches JSON with a timeout that also honours an outer abort signal. */
export async function fetchJson<T>(url: string, { signal, timeoutMs = 20000 }: FetchJsonOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Tempo esgotado', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      // The Solaris server explains its errors in a JSON { error } body.
      const body: unknown = type.includes('json') ? await res.json().catch(() => null) : null;
      const detail = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : null;
      throw new HttpError(res.status, detail ?? `HTTP ${res.status} em ${url.split('?')[0]}`);
    }
    if (!type.includes('json')) throw new HttpError(res.status, `Resposta não é JSON (${type || 'sem tipo'})`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

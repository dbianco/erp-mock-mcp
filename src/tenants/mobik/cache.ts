/** What a cached source hands out: the value, when it was read from the store, and whether that read is older than the TTL. */
export interface Reading<T> {
  value: T;
  read_at: string;
  stale: boolean;
}

export interface CachedSourceOptions<T> {
  ttlMs: number;
  load: () => Promise<T>;
  /** The copy shipped with the repository, used until the first successful read. */
  fallback: { value: T; read_at: string };
  now?: () => number;
}

/**
 * Wraps a remote read with a time-to-live. Within the TTL the stored value is returned without touching the network;
 * concurrent callers share one read; a failed read keeps the last good value (marked stale) and is not retried until
 * the TTL has passed again, so a store that is down is asked at most once per TTL.
 */
export function createCachedSource<T>(options: CachedSourceOptions<T>): () => Promise<Reading<T>> {
  const now = options.now ?? Date.now;
  let good = options.fallback;
  let lastAttempt: number | null = null;
  let lastAttemptFailed = true;
  let inFlight: Promise<void> | null = null;

  const refresh = async (): Promise<void> => {
    try {
      const value = await options.load();
      good = { value, read_at: new Date(now()).toISOString() };
      lastAttemptFailed = false;
    } catch {
      lastAttemptFailed = true;
    } finally {
      lastAttempt = now();
    }
  };

  return async () => {
    if (lastAttempt === null || now() - lastAttempt >= options.ttlMs) {
      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      await inFlight;
    }
    return { ...good, stale: lastAttemptFailed };
  };
}

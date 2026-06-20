type CacheEntry<T> = {
  expiresAt: number;
  promise?: Promise<T>;
  value?: T;
};

const jsonCache = new Map<string, CacheEntry<unknown>>();

export function hasFreshJsonCache(key: string): boolean {
  const entry = jsonCache.get(key);
  return Boolean(entry?.value && entry.expiresAt > Date.now());
}

export function invalidateJsonCache(key: string): void {
  jsonCache.delete(key);
}

export function invalidateJsonCacheByPrefix(prefix: string): void {
  for (const key of jsonCache.keys()) {
    if (key.startsWith(prefix)) {
      jsonCache.delete(key);
    }
  }
}

export async function getCachedJson<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: { ttlMs?: number; force?: boolean },
): Promise<T> {
  const ttlMs = options?.ttlMs ?? 30_000;
  const force = options?.force ?? false;
  const now = Date.now();
  const cached = jsonCache.get(key) as CacheEntry<T> | undefined;

  if (!force && cached?.value && cached.expiresAt > now) {
    return cached.value;
  }

  if (!force && cached?.promise) {
    return cached.promise;
  }

  const promise = fetcher()
    .then((value) => {
      jsonCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      return value;
    })
    .catch((error) => {
      jsonCache.delete(key);
      throw error;
    });

  jsonCache.set(key, {
    value: cached?.value,
    expiresAt: cached?.expiresAt ?? 0,
    promise,
  });

  return promise;
}

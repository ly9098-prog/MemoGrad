let queryCacheClearer: (() => void) | null = null;
let activeSessionKey: string | null = null;

export function sessionCacheKey(accessMode: string | null, userId: number | string) {
  return `${accessMode ?? "none"}:${userId}`;
}

export function shouldClearSessionCache(
  previousSessionKey: string | null,
  nextSessionKey: string,
) {
  if (previousSessionKey === null || previousSessionKey === nextSessionKey) {
    return false;
  }
  return !previousSessionKey.endsWith(":anonymous");
}

export function setSessionCacheClearer(clearer: (() => void) | null) {
  queryCacheClearer = clearer;
}

export function syncSessionCache(accessMode: string | null, userId: number | string) {
  const nextSessionKey = sessionCacheKey(accessMode, userId);
  const previousSessionKey = activeSessionKey;
  activeSessionKey = nextSessionKey;
  if (shouldClearSessionCache(previousSessionKey, nextSessionKey)) {
    queryCacheClearer?.();
  }
}

export function resetSessionCacheTracking() {
  queryCacheClearer = null;
  activeSessionKey = null;
}

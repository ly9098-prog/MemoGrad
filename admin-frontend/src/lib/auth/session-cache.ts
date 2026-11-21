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

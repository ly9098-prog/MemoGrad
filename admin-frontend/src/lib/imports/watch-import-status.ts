import { apiRequest } from "@/lib/api/client";
import { connectSSE } from "@/lib/api/sse";
import type { ImportPipelineStatusResponse } from "@/lib/api/types";

const FALLBACK_MS = 2_500;
const WATCHDOG_MS = 20_000;
const TRACE_SYNC_MS = 750;

export function watchImportStatus<Snapshot>(options: {
  path: string;
  readStreamStatus?: (status: ImportPipelineStatusResponse) => Snapshot;
  onSnapshot: (status: Snapshot) => void;
  onFetching: (fetching: boolean) => void;
  onError: () => void;
}) {
  const readStreamStatus = options.readStreamStatus;
  let closed = false;
  let request: AbortController | undefined;
  let streamHealthy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = Number.POSITIVE_INFINITY;
  let pending: Promise<void> | undefined;
  let refreshAfterFetch = false;
  let streamRevision = 0;

  function clearSchedule() {
    clearTimeout(timer);
    dueAt = Number.POSITIVE_INFINITY;
  }

  function schedule(delay: number) {
    if (closed || Date.now() + delay >= dueAt) return;
    clearSchedule();
    dueAt = Date.now() + delay;
    timer = setTimeout(() => {
      clearSchedule();
      if (pending) refreshAfterFetch = true;
      else void refresh();
    }, delay);
  }

  function refresh(): Promise<void> {
    if (closed) return Promise.resolve();
    if (pending) return pending;
    clearSchedule();
    const revision = streamRevision;
    request = new AbortController();
    options.onFetching(true);
    pending = apiRequest<Snapshot>(options.path, { signal: request.signal, timeoutMs: 12_000 })
      .then((snapshot) => {
        if (!closed && revision === streamRevision) options.onSnapshot(snapshot);
      })
      .catch(() => {
        if (!closed && revision === streamRevision) options.onError();
      })
      .finally(() => {
        pending = undefined;
        request = undefined;
        if (closed) return;
        options.onFetching(false);
        const delay = refreshAfterFetch ? 0 : streamHealthy ? WATCHDOG_MS : FALLBACK_MS;
        refreshAfterFetch = false;
        schedule(delay);
      });
    return pending;
  }

  function reconcile() {
    if (closed) return;
    streamHealthy = false;
    if (pending) refreshAfterFetch = true;
    else void refresh();
  }

  function markHealthy() {
    if (!streamHealthy) {
      streamHealthy = true;
      if (readStreamStatus && dueAt !== Number.POSITIVE_INFINITY) {
        clearSchedule();
        schedule(WATCHDOG_MS);
      }
    }
  }

  const stream = connectSSE(`${options.path}/stream`, null, {
    onOpen: readStreamStatus ? undefined : markHealthy,
    onStatus: readStreamStatus ? (status) => {
      if (closed) return;
      markHealthy();
      streamRevision++;
      options.onSnapshot(readStreamStatus(status));
    } : undefined,
    onTrace: readStreamStatus ? undefined : () => schedule(TRACE_SYNC_MS),
    onDone: reconcile,
    onError: reconcile,
  });
  schedule(readStreamStatus ? FALLBACK_MS : 0);

  return {
    refresh,
    close() {
      closed = true;
      request?.abort();
      clearSchedule();
      stream.close();
    },
  };
}

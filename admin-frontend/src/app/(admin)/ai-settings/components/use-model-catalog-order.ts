"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { parseModelCatalogOrder } from "./model-catalog-order";

const ORDER_CHANGED = "memograd:model-catalog-order-changed";
const getServerSnapshot = () => null;

export function useModelCatalogOrder(userId: number | undefined) {
  const storageKey = userId === undefined ? null : `memograd:ai-model-catalog-order:v1:${userId}`;
  const [temporaryOrder, setTemporaryOrder] = useState<{ key: string; ids: number[] } | null>(null);

  const subscribe = useCallback((onChange: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        setTemporaryOrder(null);
        onChange();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(ORDER_CHANGED, onChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ORDER_CHANGED, onChange);
    };
  }, [storageKey]);

  const getSnapshot = useCallback(() => {
    try {
      return storageKey ? window.localStorage.getItem(storageKey) : null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const storedOrder = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const order = useMemo(() => parseModelCatalogOrder(storedOrder), [storedOrder]);

  const saveOrder = (ids: number[]) => {
    if (!storageKey) return false;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(ids));
      setTemporaryOrder(null);
      window.dispatchEvent(new Event(ORDER_CHANGED));
      return true;
    } catch {
      setTemporaryOrder({ key: storageKey, ids });
      return false;
    }
  };

  return {
    order: temporaryOrder?.key === storageKey ? temporaryOrder.ids : order,
    saveOrder,
  };
}

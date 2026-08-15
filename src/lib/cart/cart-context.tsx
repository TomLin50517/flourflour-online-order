"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { CartLine } from "./types";

const STORAGE_KEY = "cart.v1";

type Listener = () => void;

let listeners: Listener[] = [];
let snapshot: CartLine[] = [];
let initialized = false;
const EMPTY_LINES: CartLine[] = [];

function lineKey(line: Pick<CartLine, "productId" | "optionItemIds">): string {
  return `${line.productId}::${[...line.optionItemIds].sort().join(",")}`;
}

function parseStorage(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}

function commit(next: CartLine[]) {
  snapshot = next;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): CartLine[] {
  if (!initialized) {
    initialized = true;
    snapshot = parseStorage();
  }
  return snapshot;
}

function getServerSnapshot(): CartLine[] {
  return EMPTY_LINES;
}

export function useCart() {
  const lines = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const addLine = useCallback((line: CartLine) => {
    const current = getSnapshot();
    const newKey = lineKey(line);
    const existingIndex = current.findIndex((l) => lineKey(l) === newKey);
    if (existingIndex >= 0) {
      const next = [...current];
      next[existingIndex] = {
        ...next[existingIndex],
        quantity: next[existingIndex].quantity + line.quantity,
      };
      commit(next);
      return;
    }
    commit([...current, line]);
  }, []);

  const updateQuantity = useCallback((index: number, quantity: number) => {
    const current = getSnapshot();
    commit(
      current
        .map((l, i) => (i === index ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const removeLine = useCallback((index: number) => {
    commit(getSnapshot().filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => commit([]), []);

  const itemCount = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity, 0),
    [lines],
  );

  return { lines, itemCount, addLine, updateQuantity, removeLine, clear };
}

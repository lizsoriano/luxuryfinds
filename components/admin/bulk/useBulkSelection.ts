"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Selection of an admin list for the bulk actions. Kept in sessionStorage under
 * a key made of the list and its filters, so it survives moving between pages
 * of the SAME search (page 1 → 2 → 3) and is dropped when the search or the
 * filters change (a different key starts empty).
 */

type Store = { ids: ReadonlySet<string>; listeners: Set<() => void> };

const stores = new Map<string, Store>();
const EMPTY: ReadonlySet<string> = new Set();
const PREFIX = "lf-bulk:";

function read(key: string): ReadonlySet<string> {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function storeFor(key: string): Store {
  let store = stores.get(key);
  if (!store) {
    store = { ids: typeof window === "undefined" ? EMPTY : read(key), listeners: new Set() };
    stores.set(key, store);
  }
  return store;
}

function write(key: string, ids: ReadonlySet<string>) {
  const store = storeFor(key);
  store.ids = ids;
  try {
    // Only this list's selection is kept: older keys of the same list are dropped.
    const list = key.split("?")[0];
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const existing = window.sessionStorage.key(index);
      if (existing && existing.startsWith(PREFIX + list) && existing !== PREFIX + key) window.sessionStorage.removeItem(existing);
    }
    if (ids.size) window.sessionStorage.setItem(PREFIX + key, JSON.stringify([...ids]));
    else window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    // Private mode / storage full: the selection still works on this page.
  }
  for (const listener of store.listeners) listener();
}

export type BulkSelection = {
  selected: ReadonlySet<string>;
  count: number;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Header checkbox: adds or removes the visible rows, leaving other pages' rows as they are. */
  setVisible: (checked: boolean) => void;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  /** Selected rows that are not on this page. */
  offPageCount: number;
  replace: (ids: Iterable<string>) => void;
  clear: () => void;
};

export function useBulkSelection(storageKey: string, visibleIds: readonly string[]): BulkSelection {
  const subscribe = useCallback(
    (listener: () => void) => {
      const store = storeFor(storageKey);
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    [storageKey],
  );
  const selected = useSyncExternalStore(
    subscribe,
    () => storeFor(storageKey).ids,
    () => EMPTY,
  );

  return useMemo(() => {
    const visible = new Set(visibleIds);
    const visibleSelected = visibleIds.filter((id) => selected.has(id)).length;
    return {
      selected,
      count: selected.size,
      has: (id: string) => selected.has(id),
      toggle: (id: string) => {
        const next = new Set(storeFor(storageKey).ids);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        write(storageKey, next);
      },
      setVisible: (checked: boolean) => {
        const next = new Set(storeFor(storageKey).ids);
        for (const id of visibleIds) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        write(storageKey, next);
      },
      allVisibleSelected: visibleIds.length > 0 && visibleSelected === visibleIds.length,
      someVisibleSelected: visibleSelected > 0 && visibleSelected < visibleIds.length,
      offPageCount: [...selected].filter((id) => !visible.has(id)).length,
      replace: (ids: Iterable<string>) => write(storageKey, new Set(ids)),
      clear: () => write(storageKey, new Set()),
    };
  }, [selected, storageKey, visibleIds]);
}

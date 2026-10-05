import type { StoredDraft } from "./staff-photo-drafts";

/**
 * Device copy of the photo drafts (browser only). One IndexedDB store keyed by
 * the draft id, with an index by employee (actorId) so two people sharing a
 * phone never see each other's drafts. When IndexedDB is missing or refuses to
 * write (private mode, blocked storage) the drafts live in memory only and the
 * screen says so. Every call can fail (quota); callers catch it.
 */

const DB_NAME = "luxuryfinds-staff";
const DB_VERSION = 1;
const STORE = "photo-drafts";
const OPEN_TIMEOUT_MS = 4000;

export type DraftStorage = {
  kind: "indexeddb" | "memory";
  list: (actorId: string) => Promise<StoredDraft[]>;
  put: (draft: StoredDraft) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

/** What is written: the photo goes as a Blob, or as bytes where Blobs cannot be stored. */
type Row = Omit<StoredDraft, "photo"> & { photo: Blob | null; photoBytes?: ArrayBuffer; photoType?: string };

export function memoryDraftStorage(): DraftStorage {
  const rows = new Map<string, StoredDraft>();
  return {
    kind: "memory",
    list: async (actorId) => [...rows.values()].filter((row) => row.actorId === actorId),
    put: async (draft) => { rows.set(draft.id, draft); },
    remove: async (id) => { rows.delete(id); },
  };
}

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB"));
  });
}

function transaction(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => void) {
  return new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, mode);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("La copia en el dispositivo se canceló."));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB"));
    run(tx.objectStore(STORE));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("IndexedDB no respondió.")), OPEN_TIMEOUT_MS);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }).createIndex("actorId", "actorId");
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => { clearTimeout(timer); reject(req.error ?? new Error("IndexedDB")); };
    req.onblocked = () => { clearTimeout(timer); reject(new Error("IndexedDB bloqueado por otra pestaña.")); };
  });
}

function fromRow(row: Row): StoredDraft {
  const { photoBytes, photoType, ...rest } = row;
  const photo = rest.photo ?? (photoBytes ? new Blob([photoBytes], { type: photoType || "image/jpeg" }) : null);
  return { ...rest, photo };
}

function isCloneError(error: unknown) {
  return error instanceof DOMException && (error.name === "DataCloneError" || error.name === "UnknownError");
}

export async function openDraftStorage(): Promise<DraftStorage> {
  if (typeof indexedDB === "undefined") return memoryDraftStorage();
  let db: IDBDatabase;
  try {
    db = await openDatabase();
    // Some private modes open the database but refuse every write: probe once.
    const probe = { id: "__probe__", actorId: "__probe__" };
    await transaction(db, "readwrite", (store) => { store.put(probe); });
    await transaction(db, "readwrite", (store) => { store.delete(probe.id); });
  } catch {
    return memoryDraftStorage();
  }
  // Ask the browser not to evict this origin's data under storage pressure (best effort).
  try { void navigator.storage?.persist?.(); } catch { /* optional */ }

  const put = async (draft: StoredDraft) => {
    try {
      await transaction(db, "readwrite", (store) => { store.put(draft as Row); });
    } catch (error) {
      // Older Safari cannot store Blobs in IndexedDB: store the bytes instead.
      if (!draft.photo || !isCloneError(error)) throw error;
      const bytes = await draft.photo.arrayBuffer();
      const row: Row = { ...draft, photo: null, photoBytes: bytes, photoType: draft.photo.type };
      await transaction(db, "readwrite", (store) => { store.put(row); });
    }
  };

  return {
    kind: "indexeddb",
    list: async (actorId) => {
      const tx = db.transaction(STORE, "readonly");
      const rows = await request(tx.objectStore(STORE).index("actorId").getAll(actorId) as IDBRequest<Row[]>);
      return rows.map(fromRow);
    },
    put,
    remove: (id) => transaction(db, "readwrite", (store) => { store.delete(id); }),
  };
}

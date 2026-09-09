/**
 * Where the data came from last time.
 *
 * Two stores, because one will not do. The *choice* is a small JSON object and
 * belongs in `localStorage`; a picked directory is a
 * `FileSystemDirectoryHandle`, which `JSON.stringify` turns into `{}` — it is
 * structured-cloneable but not serialisable, so it has to live in IndexedDB.
 * Putting a handle in `localStorage` does not throw: it stores an empty object,
 * and the folder quietly stops being remembered.
 *
 * The other thing a handle carries is **permission, which does not survive a
 * reload**. `queryPermission` reports `"prompt"` on a fresh page even for a
 * folder granted yesterday, and `requestPermission` only works inside a user
 * gesture. So a remembered disc cannot be reopened silently on boot and the
 * interface has to offer a button. An HTTP tree has no such restriction and
 * reopens on its own.
 *
 * masax remembers *several* folders, because one disc is not the whole
 * catalogue: disc A carries 30 of the 52 catalogues and one half of the vehicle
 * index, disc B the rest.
 */

/** What the app should open on boot. */
export type SavedSource =
  | { kind: "http"; url: string }
  /** Names are for the interface; the handles themselves are in IndexedDB. */
  | { kind: "folders"; names: string[] }
  /**
   * A copy the user made in this browser.
   *
   * Nothing to remember but the kind: there is one origin private filesystem
   * per origin and the copy either exists or it does not. It is also the only
   * source that reopens with neither a permission gesture nor a host.
   */
  | { kind: "offline" };

/**
 * What was last being looked at.
 *
 * Stored by code rather than by object, because a saved selection has to be
 * matched against whatever tree is open next time — which may be a different
 * import with different catalogues. Anything that no longer resolves is
 * dropped silently: restoring part of a selection is better than refusing to
 * restore any of it, and much better than pointing at a plate that is not in
 * this data.
 */
export interface SavedSelection {
  catalogue?: string;
  model?: string;
  mainGroup?: number;
  subGroup?: number;
  /** The last VIN decoded, so a return visit starts where it left off. */
  vin?: string;
}

export interface Settings {
  source?: SavedSource;
  language?: string;
  selection?: SavedSelection;
}

const KEY = "masax.settings.v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Settings;
    // Validate rather than trust: this is user-editable storage, and a
    // half-written value would fail much later, when something tried to open
    // `undefined` as a URL.
    if (parsed.source?.kind === "http" && typeof parsed.source.url !== "string") return {};
    if (parsed.source?.kind === "folders" && !Array.isArray(parsed.source.names)) return {};
    return parsed;
  } catch {
    // Private-mode Safari throws on `localStorage` rather than returning null,
    // and a corrupt value throws in `JSON.parse`. Neither is worth failing to
    // start over.
    return {};
  }
}

export function saveSettings(next: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the app still works, it just will not remember.
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; see above.
  }
}

// --------------------------------------------------------------------------
// the directory handles
// --------------------------------------------------------------------------

const DB_NAME = "masax";
const DB_VERSION = 1;
const STORE = "handles";
const HANDLES_KEY = "discs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return undefined;
  }
  try {
    return await new Promise<T | undefined>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } finally {
    db.close();
  }
}

export async function saveDiscHandles(handles: FileSystemDirectoryHandle[]): Promise<void> {
  await withStore("readwrite", (s) => s.put(handles, HANDLES_KEY) as IDBRequest<IDBValidKey>);
}

export async function loadDiscHandles(): Promise<FileSystemDirectoryHandle[]> {
  return (
    (await withStore<FileSystemDirectoryHandle[]>("readonly", (s) => s.get(HANDLES_KEY))) ?? []
  );
}

export async function clearDiscHandles(): Promise<void> {
  await withStore("readwrite", (s) => s.delete(HANDLES_KEY) as IDBRequest<undefined>);
}

/**
 * Can we read this handle without asking?
 *
 * `"granted"` means open it now; anything else means the interface must offer a
 * button, because `requestPermission` only works inside a user gesture.
 */
export async function handleReadable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await handle.queryPermission?.({ mode: "read" })) === "granted";
  } catch {
    return false;
  }
}

/** Ask for read access. Must be called from a click or a keypress. */
export async function requestHandleAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await handle.requestPermission?.({ mode: "read" })) === "granted";
  } catch {
    return false;
  }
}

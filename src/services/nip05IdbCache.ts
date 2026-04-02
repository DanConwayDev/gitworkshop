import type { AsyncIdentityCache } from "applesauce-loaders/loaders";
import type { Identity } from "applesauce-loaders/helpers";

const DB_NAME = "gitworkshop";
const STORE_NAME = "nip05-identities";
const DB_VERSION = 1;

/** Open (or upgrade) the IndexedDB database, creating the nip05-identities store if needed. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Load all cached identities from IDB as a key→value map.
 * Used to warm the DnsIdentityLoader's in-memory map on startup so that
 * getIdentity() hits synchronously without waiting for individual loadIdentity
 * calls (which read IDB but don't write back to the in-memory map).
 */
export async function loadAllNip05FromIdb(): Promise<Record<string, Identity>> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();
      tx.oncomplete = () => {
        const keys = keysReq.result as string[];
        const vals = valsReq.result as Identity[];
        const result: Record<string, Identity> = {};
        keys.forEach((k, i) => {
          result[k] = vals[i];
        });
        resolve(result);
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return {};
  }
}

/**
 * AsyncIdentityCache backed by IndexedDB.
 *
 * DB: gitworkshop  |  Store: nip05-identities  |  Key: "name@domain"
 *
 * The DnsIdentityLoader passes the full address string as the key when
 * calling load(), and passes a Record<address, Identity> to save().
 */
export const nip05IdbCache: AsyncIdentityCache = {
  async save(identities: Record<string, Identity>): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const [address, identity] of Object.entries(identities)) {
        store.put(identity, address);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async load(address: string): Promise<Identity | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(address);
      req.onsuccess = () => resolve(req.result as Identity | undefined);
      req.onerror = () => reject(req.error);
    });
  },
};

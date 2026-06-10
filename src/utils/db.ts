import type { Pub, Building } from '../types';

const DB_NAME = 'SoakinCache';
const DB_VERSION = 1;

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('cells')) {
        db.createObjectStore('cells');
      }
      if (!db.objectStoreNames.contains('pubs')) {
        db.createObjectStore('pubs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('buildings')) {
        db.createObjectStore('buildings', { keyPath: 'id' });
      }
    };
  });
};

export const saveCacheToDB = async (
  cells: string[],
  pubs: Pub[],
  buildings: Building[]
): Promise<void> => {
  try {
    const db = await initDB();
    const tx = db.transaction(['cells', 'pubs', 'buildings'], 'readwrite');
    
    const cellStore = tx.objectStore('cells');
    cells.forEach(c => cellStore.put(Date.now(), c));
    
    const pubStore = tx.objectStore('pubs');
    pubs.forEach(p => pubStore.put(p));
    
    const bldgStore = tx.objectStore('buildings');
    buildings.forEach(b => bldgStore.put(b));

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to save cache to DB:', err);
  }
};

export const loadCacheFromDB = async (): Promise<{
  cells: Set<string>;
  pubs: globalThis.Map<number, Pub>;
  buildings: globalThis.Map<number, Building>;
}> => {
  const cells = new Set<string>();
  const pubs = new globalThis.Map<number, Pub>();
  const buildings = new globalThis.Map<number, Building>();

  try {
    const db = await initDB();
    const tx = db.transaction(['cells', 'pubs', 'buildings'], 'readonly');

    const cellStore = tx.objectStore('cells');
    const pubStore = tx.objectStore('pubs');
    const bldgStore = tx.objectStore('buildings');

    const cellsReq = cellStore.getAllKeys();
    const pubsReq = pubStore.getAll();
    const bldgsReq = bldgStore.getAll();

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    cellsReq.result.forEach(key => cells.add(key as string));
    pubsReq.result.forEach(p => pubs.set(p.id, p));
    bldgsReq.result.forEach(b => buildings.set(b.id, b));
  } catch (err) {
    console.error('Failed to load cache from DB:', err);
  }

  return { cells, pubs, buildings };
};

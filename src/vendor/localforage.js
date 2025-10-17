'use client';

const DB_NAME = 'web-os';
const DB_VERSION = 1;
const STORE_NAME = 'fs';

const openDatabase = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withStore = async (type, callback) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, type);
    const store = tx.objectStore(STORE_NAME);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const createInstance = () => ({
  async getItem(key) {
    return withStore('readonly', (store) => store.get(key));
  },
  async setItem(key, value) {
    return withStore('readwrite', (store) => store.put(value, key));
  },
  async removeItem(key) {
    return withStore('readwrite', (store) => store.delete(key));
  },
  async clear() {
    return withStore('readwrite', (store) => store.clear());
  },
  async keys() {
    return withStore('readonly', (store) => store.getAllKeys());
  },
});

export default { createInstance };

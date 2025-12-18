/* global indexedDB:false,navigator:false,console:false */
/**
 * IndexedDB wrapper for offline data persistence.
 * Provides cache-first storage for posts and embeddings data.
 */

import { fetchWrapper } from "./util.js";

const DB_NAME = "joyce-offline";
const DB_VERSION = 1;

export const STORES = {
  POSTS: "posts",
  EMBEDDINGS: "embeddings",
  META: "meta",
};

let dbPromise = null;

/**
 * Open or get the IndexedDB database connection.
 * @returns {Promise<IDBDatabase>}
 */
const getDb = () => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains(STORES.POSTS)) {
        db.createObjectStore(STORES.POSTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.EMBEDDINGS)) {
        db.createObjectStore(STORES.EMBEDDINGS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: "id" });
      }
    };
  });

  return dbPromise;
};

/**
 * Save data to IndexedDB cache.
 * @param {string} store - The store name (from STORES)
 * @param {any} data - The data to cache
 * @param {string} id - Optional ID, defaults to "data"
 * @returns {Promise<void>}
 */
export const saveToCache = async (store, data, id = "data") => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([store, STORES.META], "readwrite");
    const objectStore = transaction.objectStore(store);
    const metaStore = transaction.objectStore(STORES.META);

    // Save the data
    objectStore.put({ id, data });

    // Save metadata (timestamp)
    metaStore.put({
      id: `${store}_${id}`,
      timestamp: Date.now(),
      store,
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * Load data from IndexedDB cache.
 * @param {string} store - The store name (from STORES)
 * @param {string} id - Optional ID, defaults to "data"
 * @returns {Promise<any | null>} The cached data or null if not found
 */
export const loadFromCache = async (store, id = "data") => {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, "readonly");
      const objectStore = transaction.objectStore(store);
      const request = objectStore.get(id);

      request.onsuccess = () => {
        resolve(request.result?.data ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`Failed to load from cache (${store}):`, err);
    return null;
  }
};

/**
 * Check if data exists in IndexedDB cache.
 * @param {string} store - The store name (from STORES)
 * @param {string} id - Optional ID, defaults to "data"
 * @returns {Promise<boolean>}
 */
export const isCached = async (store, id = "data") => {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, "readonly");
      const objectStore = transaction.objectStore(store);
      const request = objectStore.count(id);

      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`Failed to check cache (${store}):`, err);
    return false;
  }
};

/**
 * Get the timestamp when data was cached.
 * @param {string} store - The store name (from STORES)
 * @param {string} id - Optional ID, defaults to "data"
 * @returns {Promise<number | null>} Unix timestamp or null if not cached
 */
export const getCacheTimestamp = async (store, id = "data") => {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.META, "readonly");
      const metaStore = transaction.objectStore(STORES.META);
      const request = metaStore.get(`${store}_${id}`);

      request.onsuccess = () => {
        resolve(request.result?.timestamp ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`Failed to get cache timestamp (${store}):`, err);
    return null;
  }
};

/**
 * Clear all cached data from a specific store.
 * @param {string} store - The store name (from STORES)
 * @returns {Promise<void>}
 */
export const clearCache = async (store) => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([store, STORES.META], "readwrite");
    const objectStore = transaction.objectStore(store);
    const metaStore = transaction.objectStore(STORES.META);

    objectStore.clear();

    // Also clear related metadata
    const metaRequest = metaStore.openCursor();
    metaRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.store === store) {
          cursor.delete();
        }
        cursor.continue();
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * Clear all offline cached data.
 * @returns {Promise<void>}
 */
export const clearAllCaches = async () => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [STORES.POSTS, STORES.EMBEDDINGS, STORES.META],
      "readwrite",
    );

    transaction.objectStore(STORES.POSTS).clear();
    transaction.objectStore(STORES.EMBEDDINGS).clear();
    transaction.objectStore(STORES.META).clear();

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * Get cache statistics (sizes and timestamps).
 * @returns {Promise<Object>} Cache stats for each store
 */
export const getCacheStats = async () => {
  const db = await getDb();

  const getStoreStats = (storeName) =>
    new Promise((resolve) => {
      const transaction = db.transaction([storeName, STORES.META], "readonly");
      const objectStore = transaction.objectStore(storeName);
      const metaStore = transaction.objectStore(STORES.META);

      let count = 0;
      let timestamp = null;

      const countRequest = objectStore.count();
      countRequest.onsuccess = () => {
        count = countRequest.result;
      };

      const metaRequest = metaStore.get(`${storeName}_data`);
      metaRequest.onsuccess = () => {
        timestamp = metaRequest.result?.timestamp ?? null;
      };

      transaction.oncomplete = () => {
        resolve({ count, timestamp, cached: count > 0 });
      };
      transaction.onerror = () => {
        resolve({ count: 0, timestamp: null, cached: false });
      };
    });

  const [posts, embeddings] = await Promise.all([
    getStoreStats(STORES.POSTS),
    getStoreStats(STORES.EMBEDDINGS),
  ]);

  return { posts, embeddings };
};

/**
 * Create a cached fetcher with stale-while-revalidate strategy.
 * Returns cached data immediately (if available) while refreshing in background.
 * @param {Object} options
 * @param {string} options.store - The IndexedDB store name (from STORES)
 * @param {string|Function} options.url - URL string or function returning URL
 * @param {string} options.label - Label for console warnings (e.g., "Posts")
 * @returns {Function} Async function that returns cached/fetched data
 */
export const createCachedFetcher = ({ store, url, label }) => {
  const getUrl = typeof url === "function" ? url : () => url;

  const refreshInBackground = () => {
    if (!navigator.onLine) return;

    fetchWrapper(getUrl())
      .then((data) => saveToCache(store, data))
      .catch((err) => {
        console.warn(`[${label}] Background refresh failed:`, err);
      });
  };

  return async () => {
    // Try to load from IndexedDB cache first
    const cached = await loadFromCache(store);
    if (cached) {
      // Refresh in background (stale-while-revalidate)
      refreshInBackground();
      return cached;
    }

    // Fetch from network
    const data = await fetchWrapper(getUrl());

    // Save to IndexedDB for offline use
    await saveToCache(store, data).catch((err) => {
      console.warn(`[${label}] Failed to save to cache:`, err);
    });

    return data;
  };
};

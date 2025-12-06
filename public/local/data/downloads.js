/* global performance:false */
import { getPosts, getPostsEmbeddings } from "./api/posts.js";
import { getDb } from "./api/search.js";

// ==============================
// Download Management
// ==============================
export const RESOURCES = {
  POSTS_DATA: {
    id: "posts_data",
    get: getPosts,
  },
  POSTS_EMBEDDINGS: {
    id: "posts_embeddings",
    get: getPostsEmbeddings,
  },
  DB: {
    id: "db",
    get: getDb,
    deps: ["posts_data", "posts_embeddings"],
  },
};

const downloadStatus = new Map();
const downloadCallbacks = new Map();
const downloadedData = new Map();

/**
 * Get download status for a resource
 * @param {string} resourceId
 * @returns {"not_loaded" | "loading" | "loaded" | "error"}
 */
export const getDownloadStatus = (resourceId) => {
  return downloadStatus.get(resourceId) || "not_loaded";
};

/**
 * Get downloaded data for a resource (sync)
 * @param {string} resourceId
 * @returns {any | null} The downloaded data or null if not loaded
 */
export const getDownloadedData = (resourceId) => {
  return downloadedData.get(resourceId) ?? null;
};

/**
 * Set download status for a resource
 * @param {string} resourceId
 * @param {"not_loaded" | "loading" | "loaded" | "error"} status
 * @param {{ error?: Error, elapsed?: number }} options
 */
const setDownloadStatus = (
  resourceId,
  status,
  { error = null, elapsed = null } = {},
) => {
  downloadStatus.set(resourceId, status);
  // Copy array before iterating to avoid issues if callbacks unsubscribe during iteration
  const callbacks = [...(downloadCallbacks.get(resourceId) || [])];
  callbacks.forEach((cb) => cb(status, { error, elapsed }));
};

/**
 * Wait for a download to complete
 * @param {string} resourceId
 * @returns {Promise<void>} Resolves when loaded, rejects on error
 */
const waitForDownload = (resourceId) => {
  return new Promise((resolve, reject) => {
    const status = downloadStatus.get(resourceId);
    if (status === "loaded") return resolve();
    if (status === "error")
      return reject(new Error(`Dependency ${resourceId} failed`));

    const unsubscribe = subscribeDownloadStatus(resourceId, (newStatus) => {
      if (newStatus === "loaded") {
        unsubscribe();
        resolve();
      } else if (newStatus === "error") {
        unsubscribe();
        reject(new Error(`Dependency ${resourceId} failed`));
      }
    });
  });
};

/**
 * Subscribe to download status changes
 * @param {string} resourceId
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
export const subscribeDownloadStatus = (resourceId, callback) => {
  if (!downloadCallbacks.has(resourceId)) {
    downloadCallbacks.set(resourceId, []);
  }
  downloadCallbacks.get(resourceId).push(callback);
  return () => {
    const callbacks = downloadCallbacks.get(resourceId);
    const index = (callbacks || []).indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  };
};

/**
 * Start a download for a resource
 * @param {{ id: string, get: () => Promise<any>, deps?: string[] }} resource
 */
export const startDownload = async (resource) => {
  const { id, get, deps } = resource;
  if (
    downloadStatus.get(id) === "loading" ||
    downloadStatus.get(id) === "loaded"
  ) {
    return;
  }

  setDownloadStatus(id, "loading");

  // Wait for dependencies before starting the timer
  if (deps?.length) {
    await Promise.all(deps.map((depId) => waitForDownload(depId)));
  }

  // TODO(BUG): Occasionally elapsed is `null` upstream. Not fixed yet.
  const start = performance.now();
  try {
    const result = await get();
    downloadedData.set(id, result);
    const elapsed = performance.now() - start;
    setDownloadStatus(id, "loaded", { elapsed });
  } catch (error) {
    const elapsed = performance.now() - start;
    setDownloadStatus(id, "error", { error, elapsed });
  }
};

/**
 * Initialize download system and start default downloads
 */
export const init = () => {
  startDownload(RESOURCES.POSTS_DATA);
  startDownload(RESOURCES.POSTS_EMBEDDINGS);
  startDownload(RESOURCES.DB);
};

/* global performance:false */
import { getPosts, getPostsEmbeddings } from "./api/posts.js";

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
};

const downloadStatus = new Map();
const downloadCallbacks = new Map();

/**
 * Get download status for a resource
 * @param {string} resourceId
 * @returns {"not_loaded" | "loading" | "loaded" | "error"}
 */
export const getDownloadStatus = (resourceId) => {
  return downloadStatus.get(resourceId) || "not_loaded";
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
  const callbacks = downloadCallbacks.get(resourceId) || [];
  callbacks.forEach((cb) => cb(status, { error, elapsed }));
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
 * @param {{ id: string, get: () => Promise<any> }} resource
 */
export const startDownload = async (resource) => {
  const { id, get } = resource;
  if (
    downloadStatus.get(id) === "loading" ||
    downloadStatus.get(id) === "loaded"
  ) {
    return;
  }

  setDownloadStatus(id, "loading");
  const start = performance.now();
  try {
    await get();
    const elapsed = performance.now() - start;
    setDownloadStatus(id, "loaded", { elapsed });
  } catch (error) {
    const elapsed = performance.now() - start;
    console.error(`Error downloading ${id}:`, error); // eslint-disable-line no-undef
    setDownloadStatus(id, "error", { error, elapsed });
  }
};

/**
 * Initialize download system and start default downloads
 */
export const init = () => {
  startDownload(RESOURCES.POSTS_DATA);
  startDownload(RESOURCES.POSTS_EMBEDDINGS);
};

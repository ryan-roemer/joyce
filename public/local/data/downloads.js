import { getPosts } from "./api/posts.js";

// ==============================
// Download Management
// ==============================
export const RESOURCES = {
  POSTS_DATA: {
    id: "posts_data",
    get: getPosts,
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
 * @param {Error|null} error
 */
const setDownloadStatus = (resourceId, status, error = null) => {
  downloadStatus.set(resourceId, status);
  const callbacks = downloadCallbacks.get(resourceId) || [];
  callbacks.forEach((cb) => cb(status, error));
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
    const index = callbacks.indexOf(callback);
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
  try {
    await get();
    setDownloadStatus(id, "loaded");
  } catch (error) {
    setDownloadStatus(id, "error", error);
  }
};

/**
 * Initialize download system and start default downloads
 */
export const init = () => {
  startDownload(RESOURCES.POSTS_DATA);
};

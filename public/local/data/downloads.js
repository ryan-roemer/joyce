import { getPosts } from "./api/posts.js";

// ==============================
// Download Management
// ==============================
const RESOURCE_IDS = {
  POSTS_DATA: "posts_data",
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
 * Start downloading posts data
 */
const startPostsDataDownload = async () => {
  const resourceId = RESOURCE_IDS.POSTS_DATA;
  if (
    downloadStatus.get(resourceId) === "loading" ||
    downloadStatus.get(resourceId) === "loaded"
  ) {
    return;
  }

  setDownloadStatus(resourceId, "loading");
  try {
    // Use getPosts to ensure data is cached
    await getPosts();
    setDownloadStatus(resourceId, "loaded");
  } catch (error) {
    setDownloadStatus(resourceId, "error", error);
  }
};

/**
 * Start a download for a resource
 * @param {string} resourceId
 */
export const startDownload = (resourceId) => {
  if (resourceId === RESOURCE_IDS.POSTS_DATA) {
    startPostsDataDownload();
  }
};

/**
 * Initialize download system and start default downloads
 */
export const init = () => {
  // Auto-start posts data download
  startPostsDataDownload();
};

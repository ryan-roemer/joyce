/* global fetch:false */
import { getAndCache } from "../../shared-util.js";

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

// ==============================
// Helpers
// ==============================
const getPosts = getAndCache(async () => {
  const response = await fetch("/data/posts.json");
  return response.json();
});

const filterPosts = async ({
  org,
  postType = [],
  minDate,
  categoryPrimary = [],
  withContent = false,
}) => {
  const postTypeSet = new Set(postType);
  const categoryPrimarySet = new Set(categoryPrimary);
  const minDateObj = minDate ? new Date(minDate) : null; // Precompute minDate as a Date object
  const postsObj = await getPosts();
  return Object.values(postsObj)
    .filter(
      (post) =>
        (!org || post.org === org) &&
        (postType.length === 0 || postTypeSet.has(post.postType)) &&
        (!minDateObj || new Date(post.date) >= minDateObj) &&
        (categoryPrimary.length === 0 ||
          categoryPrimarySet.has(post.categories?.primary)),
    )
    .map((post) => (withContent ? post : { ...post, content: undefined }));
};

// ==============================
// API
// ==============================
/**
 * Get posts with optional filtering.
 * @param {Object} params
 * @param {string[]} params.postType
 * @param {string} params.minDate
 * @param {string[]} params.categoryPrimary
 * @param {boolean} params.withContent
 * @returns {Promise<{posts: Object, metadata: Object}>}
 */
export const posts = async (...args) => {
  return {
    posts: await filterPosts(...args),
    metadata: {},
  };
};

/**
 * Search for posts matching a query.
 * @param {Object} params
 * @param {string} params.query
 * @param {string[]} params.postType
 * @param {string} params.minDate
 * @param {string[]} params.categoryPrimary
 * @param {boolean} params.withContent
 * @param {string} params.datastore
 * @returns {Promise<{posts: Object, chunks: Array, metadata: Object}>}
 */
// TODO(LOCAL): IMPLEMENT!!!
export const search = async () => {
  return {
    posts: [],
    chunks: [],
    metadata: {},
  };
};

/**
 * Chat with AI using streaming responses.
 * @param {Object} params
 * @param {string} params.api - Either "chat" or "responses"
 * @param {string} params.query
 * @param {string[]} params.postType
 * @param {string} params.minDate
 * @param {string[]} params.categoryPrimary
 * @param {boolean} params.withContent
 * @param {string} params.model
 * @param {string} params.provider
 * @param {number} params.temperature
 * @param {string} params.datastore
 * @returns {AsyncGenerator} Streaming JSON response
 */
// TODO(LOCAL): IMPLEMENT!!!
export async function* chat() {}

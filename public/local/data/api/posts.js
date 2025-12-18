/* global navigator:false */
import { getEmbeddingsPath } from "../../../config.js";
import { getAndCache } from "../../../shared-util.js";
import { fetchWrapper } from "../util.js";
import { saveToCache, loadFromCache, isCached, STORES } from "../storage.js";

/**
 * Fetch posts with IndexedDB cache-first strategy.
 * Tries to load from cache first, falls back to network, then saves to cache.
 */
export const getPosts = getAndCache(async () => {
  // Try to load from IndexedDB cache first
  const cached = await loadFromCache(STORES.POSTS);
  if (cached) {
    // Optionally refresh in background (stale-while-revalidate)
    refreshPostsInBackground();
    return cached;
  }

  // Fetch from network
  const data = await fetchWrapper("/data/posts.json");

  // Save to IndexedDB for offline use
  await saveToCache(STORES.POSTS, data).catch((err) => {
    console.warn("[Posts] Failed to save to cache:", err); // eslint-disable-line no-undef
  });

  return data;
});

/**
 * Refresh posts data in background without blocking.
 * This enables stale-while-revalidate pattern.
 */
const refreshPostsInBackground = () => {
  // Only refresh if online
  if (!navigator.onLine) return;

  fetchWrapper("/data/posts.json")
    .then((data) => {
      saveToCache(STORES.POSTS, data);
    })
    .catch((err) => {
      console.warn("[Posts] Background refresh failed:", err); // eslint-disable-line no-undef
    });
};

/**
 * Fetch embeddings with IndexedDB cache-first strategy.
 */
export const getPostsEmbeddings = getAndCache(async () => {
  // Try to load from IndexedDB cache first
  const cached = await loadFromCache(STORES.EMBEDDINGS);
  if (cached) {
    // Optionally refresh in background
    refreshEmbeddingsInBackground();
    return cached;
  }

  // Fetch from network
  const data = await fetchWrapper(getEmbeddingsPath());

  // Save to IndexedDB for offline use
  await saveToCache(STORES.EMBEDDINGS, data).catch((err) => {
    console.warn("[Embeddings] Failed to save to cache:", err); // eslint-disable-line no-undef
  });

  return data;
});

/**
 * Refresh embeddings data in background without blocking.
 */
const refreshEmbeddingsInBackground = () => {
  if (!navigator.onLine) return;

  fetchWrapper(getEmbeddingsPath())
    .then((data) => {
      saveToCache(STORES.EMBEDDINGS, data);
    })
    .catch((err) => {
      console.warn("[Embeddings] Background refresh failed:", err); // eslint-disable-line no-undef
    });
};

/**
 * Check if posts data is cached in IndexedDB (offline-ready).
 * @returns {Promise<boolean>}
 */
export const isPostsCached = () => isCached(STORES.POSTS);

/**
 * Check if embeddings data is cached in IndexedDB (offline-ready).
 * @returns {Promise<boolean>}
 */
export const isEmbeddingsCached = () => isCached(STORES.EMBEDDINGS);

export const getPost = async (slug) => {
  const postsObj = await getPosts();
  const post = postsObj[slug];
  if (!post) {
    throw new Error(`Post not found: ${slug}`);
  }

  return post;
};

const filterPosts = async ({
  postType = [],
  minDate,
  categoryPrimary = [],
  withContent = false,
}) => {
  const postTypeSet = new Set(postType);
  const categoryPrimarySet = new Set(categoryPrimary);
  const minDateObj = minDate ? new Date(minDate) : null;
  const postsObj = await getPosts();
  return Object.values(postsObj)
    .filter(
      (post) =>
        (postType.length === 0 || postTypeSet.has(post.postType)) &&
        (!minDateObj || new Date(post.date) >= minDateObj) &&
        (categoryPrimary.length === 0 ||
          categoryPrimarySet.has(post.categories?.primary)),
    )
    .map((post) => (withContent ? post : { ...post, content: undefined }));
};

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

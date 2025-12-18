import { getEmbeddingsPath } from "../../../config.js";
import { getAndCache } from "../../../shared-util.js";
import { createCachedFetcher, isCached, STORES } from "../storage.js";

/**
 * Fetch posts with IndexedDB cache-first strategy (stale-while-revalidate).
 */
export const getPosts = getAndCache(
  createCachedFetcher({
    store: STORES.POSTS,
    url: "/data/posts.json",
    label: "Posts",
  }),
);

/**
 * Fetch embeddings with IndexedDB cache-first strategy (stale-while-revalidate).
 */
export const getPostsEmbeddings = getAndCache(
  createCachedFetcher({
    store: STORES.EMBEDDINGS,
    url: getEmbeddingsPath,
    label: "Embeddings",
  }),
);

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

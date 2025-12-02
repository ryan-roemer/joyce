/* global fetch:false */
import { getAndCache } from "../../shared-util.js";

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

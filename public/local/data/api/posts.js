/* global fetch:false */
import { getAndCache } from "../../../shared-util.js";

// TODO: Place in utils somewhere.
const fetchWrapper = async (url) => {
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`Failed to fetch posts data: ${err.message}`);
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch/parse posts data (${response.status}): ${response.statusText}`,
    );
  }
  try {
    return await response.json();
  } catch (err) {
    throw new Error(`Failed to parse posts data: ${err.message}`);
  }
};

export const getPosts = getAndCache(() => fetchWrapper("/data/posts.json"));

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

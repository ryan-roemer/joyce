/**
 * Get posts with optional filtering.
 * @param {Object} params
 * @param {string[]} params.postType
 * @param {string} params.minDate
 * @param {string[]} params.categoryPrimary
 * @param {boolean} params.withContent
 * @returns {Promise<{posts: Object, metadata: Object}>}
 */
// TODO(LOCAL): IMPLEMENT!!!
export const posts = async () => {
  return {
    posts: [],
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

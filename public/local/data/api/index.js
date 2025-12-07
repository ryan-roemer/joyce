// ==============================
// API
// ==============================
export { posts } from "./posts.js";
export { search } from "./search.js";

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

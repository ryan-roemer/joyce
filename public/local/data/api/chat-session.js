// Chat Session Facade
// High-level API for RAG-based conversations
// Encapsulates: search → context building → conversation session → messaging

import { search } from "./search.js";
import { buildContextFromChunks, wrapQueryForRag } from "./chat.js";
import {
  createConversationSession,
  ConversationLimitError,
} from "./conversation-session.js";
import { getProviderCapabilities } from "./llm.js";
import { searchResultsToPosts } from "../../../app/data/util.js";

// Re-export for convenience
export { ConversationLimitError };

/**
 * @typedef {Object} ChatSession
 * @property {function(string, Object): AsyncGenerator} start - Start new conversation with RAG
 * @property {function(string): AsyncGenerator} continue - Send follow-up message
 * @property {function(): Object} getCapabilities - Get model capabilities
 * @property {function(): boolean} canContinue - Check if more turns possible
 * @property {function(): Object|null} getSearchData - Get search results from start()
 * @property {function(): Object} getModel - Get { provider, model }
 * @property {function(): void} destroy - Clean up resources
 */

/**
 * Create a chat session for RAG-based conversations.
 *
 * This facade encapsulates the entire conversation lifecycle:
 * 1. RAG search to find relevant content
 * 2. Context building from search chunks
 * 3. Conversation session creation
 * 4. Message streaming (first and follow-up)
 *
 * @param {Object} options
 * @param {string} options.provider - LLM provider ("webLlm" | "chrome")
 * @param {string} options.model - Model ID
 * @param {number} options.temperature - Sampling temperature
 * @returns {ChatSession}
 */
export const createChatSession = ({ provider, model, temperature }) => {
  // Session state
  let conversationSession = null;
  let searchData = null;
  let destroyed = false;

  // Get capabilities upfront (doesn't require async)
  const capabilities = getProviderCapabilities(provider, model);

  return {
    /**
     * Start a new conversation with RAG search.
     *
     * Performs:
     * 1. RAG search for relevant content
     * 2. Context building from chunks
     * 3. Conversation session creation
     * 4. First message streaming
     *
     * @param {string} query - User's initial query
     * @param {Object} searchOptions - Search filter options
     * @param {string[]} searchOptions.postType - Post types to filter
     * @param {string} searchOptions.minDate - Minimum date filter
     * @param {string[]} searchOptions.categoryPrimary - Categories to filter
     * @yields {{ type: "search" | "data" | "usage" | "done", message: any }}
     */
    async *start(
      query,
      { postType = [], minDate = "", categoryPrimary = [] } = {},
    ) {
      if (destroyed) {
        throw new Error("Session destroyed");
      }

      // Clean up any existing session
      if (conversationSession) {
        conversationSession.destroy();
        conversationSession = null;
      }
      searchData = null;

      const startTime = Date.now();

      // Step 1: RAG search
      const searchResults = await search({
        query,
        postType,
        minDate,
        categoryPrimary,
        withContent: false,
      });

      const { posts: fetchedPosts, chunks, metadata } = searchResults;
      metadata.elapsed.search = Date.now() - startTime;

      // Step 2: Build context from chunks
      const context = await buildContextFromChunks({
        chunks,
        query,
        provider,
        model,
      });
      metadata.context = context;

      // Store search data for later retrieval
      searchData = {
        posts: fetchedPosts,
        chunks,
        metadata,
        // Pre-compute posts for UI display
        displayPosts: searchResultsToPosts({ posts: fetchedPosts, chunks }),
      };

      // Yield search results for UI update
      yield {
        type: "search",
        message: {
          posts: fetchedPosts,
          chunks,
          metadata,
          displayPosts: searchData.displayPosts,
        },
      };

      // Step 3: Create conversation session
      conversationSession = await createConversationSession({
        provider,
        model,
        temperature,
        systemContext: context,
      });

      // Step 4: Send first message (wrapped for RAG)
      const wrappedQuery = wrapQueryForRag(query);
      let firstTokenTime = null;

      for await (const event of conversationSession.sendMessage(wrappedQuery)) {
        if (event.type === "data") {
          if (firstTokenTime === null) {
            firstTokenTime = Date.now() - startTime;
          }
          yield event;
        } else if (event.type === "usage") {
          // Enrich usage with timing
          yield {
            type: "usage",
            message: {
              ...event.message,
              elapsed: {
                ...metadata.elapsed,
                tokensFirst: firstTokenTime,
                tokensLast: Date.now() - startTime,
              },
            },
          };
        }
      }

      yield { type: "done", message: null };
    },

    /**
     * Continue the conversation with a follow-up message.
     *
     * Uses the existing session created by start().
     * Follow-up queries don't need RAG wrapper - sent as-is.
     *
     * @param {string} query - User's follow-up query
     * @yields {{ type: "data" | "usage" | "done", message: any }}
     */
    async *continue(query) {
      if (destroyed) {
        throw new Error("Session destroyed");
      }

      if (!conversationSession) {
        throw new Error(
          "No conversation session available. Call start() first.",
        );
      }

      const startTime = Date.now();
      let firstTokenTime = null;

      // Follow-up queries don't need the RAG wrapper
      for await (const event of conversationSession.sendMessage(query)) {
        if (event.type === "data") {
          if (firstTokenTime === null) {
            firstTokenTime = Date.now() - startTime;
          }
          yield event;
        } else if (event.type === "usage") {
          // Enrich usage with timing
          yield {
            type: "usage",
            message: {
              ...event.message,
              elapsed: {
                tokensFirst: firstTokenTime,
                tokensLast: Date.now() - startTime,
              },
            },
          };
        }
      }

      yield { type: "done", message: null };
    },

    /**
     * Get model capabilities.
     * @returns {{ supportsMultiTurn: boolean, supportsTokenTracking: boolean }}
     */
    getCapabilities() {
      return { ...capabilities };
    },

    /**
     * Check if the conversation can continue with more turns.
     * @returns {boolean}
     */
    canContinue() {
      if (!conversationSession) {
        return true; // Not started yet, can start
      }
      return conversationSession.canContinue();
    },

    /**
     * Get search data from the last start() call.
     * @returns {{ posts, chunks, metadata, displayPosts } | null}
     */
    getSearchData() {
      return searchData;
    },

    /**
     * Get the model this session was created with.
     * @returns {{ provider: string, model: string }}
     */
    getModel() {
      return { provider, model };
    },

    /**
     * Clean up session resources.
     */
    destroy() {
      destroyed = true;
      if (conversationSession) {
        conversationSession.destroy();
        conversationSession = null;
      }
      searchData = null;
    },
  };
};

// Chat Session - Unified API for RAG-based conversations
// Encapsulates: search → context building → provider dispatch → messaging

import { search } from "./search.js";
import {
  buildContextFromChunks,
  rebuildContextWithLimit,
  BASE_TOKEN_ESTIMATE,
} from "./chat.js";
import { getProviderCapabilities } from "./llm.js";
import { searchResultsToPosts } from "../../../app/data/util.js";
import { estimateTokens } from "../util.js";
import { createHandler as createChromeHandler } from "./providers/chrome.js";
import { createHandler as createWebLlmHandler } from "./providers/web-llm.js";
import { buildBasePrompts } from "./chat.js";
import {
  getModelCfg,
  MIN_CONTEXT_CHUNKS,
  THROW_ON_TOKEN_LIMIT,
  MAX_OUTPUT_TOKENS,
} from "../../../config.js";

// Minimum tokens needed for a meaningful exchange (question + response)
const MIN_TOKENS_FOR_EXCHANGE = 500;

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
 * @param {Object} options
 * @param {string} options.provider - LLM provider ("webLlm" | "chrome")
 * @param {string} options.model - Model ID
 * @param {number} options.temperature - Sampling temperature
 * @returns {ChatSession}
 */
export const createChatSession = ({ provider, model, temperature }) => {
  // Session state
  let searchData = null;
  let destroyed = false;

  // Get model config and capabilities upfront
  const capabilities = getProviderCapabilities(provider, model);
  const modelCfg = getModelCfg({ provider, model });
  const maxTokens = modelCfg.maxTokens ?? Infinity;

  // Conversation state
  const history = []; // { role, content }[]
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Context state
  let currentSystemContext = "";
  let currentChunkCount = 0;
  let currentTokenBreakdown = null;
  let rawChunks = [];
  let initialQuery = "";

  // Provider handler
  let handler = null;

  /**
   * Build contextTokens object for usage events.
   */
  const buildContextTokens = (userMessage) => {
    if (!currentTokenBreakdown) return null;
    const queryTokens = estimateTokens(userMessage);
    return {
      basePromptTokens: BASE_TOKEN_ESTIMATE,
      queryTokens,
      chunksTokens: currentTokenBreakdown.chunksTokens,
      chunkCount: currentChunkCount,
      totalTokens:
        BASE_TOKEN_ESTIMATE + currentTokenBreakdown.chunksTokens + queryTokens,
    };
  };

  /**
   * Get current token usage.
   */
  const getTokenUsage = () => {
    const used = totalInputTokens + totalOutputTokens;
    const available = Math.max(0, maxTokens - used);
    return { used, available, limit: maxTokens };
  };

  /**
   * Check if we can continue before sending a message.
   */
  const checkCanContinue = () => {
    if (!capabilities.supportsMultiTurn && history.length > 0) {
      return false;
    }
    const { available } = getTokenUsage();
    return available > MIN_TOKENS_FOR_EXCHANGE;
  };

  /**
   * Create the appropriate handler for the current provider.
   */
  const createHandler = async () => {
    if (provider === "chrome") {
      return createChromeHandler({
        model,
        systemContext: currentSystemContext,
        temperature,
      });
    } else if (provider === "webLlm") {
      return createWebLlmHandler({
        model,
        temperature,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }
  };

  /**
   * Build messages array for web-llm (stateless, needs full history).
   */
  const buildMessages = (userMessage) => [
    ...buildBasePrompts(currentSystemContext),
    ...history,
    { role: "user", content: userMessage },
  ];

  /**
   * Stream a message through the provider and yield enriched events.
   * Single enrichment point for all usage data.
   */
  async function* streamMessage(userMessage, startTime) {
    // Writer API check for follow-up
    if (
      provider === "chrome" &&
      !capabilities.supportsMultiTurn &&
      history.length > 0
    ) {
      throw new Error(
        "Follow-up questions are not supported with the Writer API. " +
          "Please start a new conversation or switch to the Prompt API model.",
      );
    }

    // Create handler if needed
    if (!handler) {
      handler = await createHandler();
    }

    // For web-llm, pass full messages; for Chrome, just user message
    const input =
      provider === "webLlm" ? buildMessages(userMessage) : userMessage;

    let firstTokenTime = null;

    for await (const event of handler.sendMessage(input)) {
      if (event.type === "data") {
        if (firstTokenTime === null) {
          firstTokenTime = Date.now() - startTime;
        }
        yield { type: "data", message: event.content };
      } else if (event.type === "done") {
        // Update cumulative token tracking
        totalInputTokens += event.usage.inputTokens;
        totalOutputTokens += event.usage.outputTokens;

        // Add to history
        history.push({ role: "user", content: userMessage });
        history.push({
          role: "assistant",
          content: event.usage.assistantContent,
        });

        // Yield finishReason
        yield { type: "finishReason", message: event.finishReason };

        // Yield enriched usage (single enrichment point)
        yield {
          type: "usage",
          message: {
            // Per-turn tokens
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            // Cumulative tokens
            totalInputTokens,
            totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
            // Context info
            available: getTokenUsage().available,
            limit: maxTokens,
            turnNumber: Math.floor(history.length / 2),
            contextTokens: buildContextTokens(userMessage),
            // Debug info
            prompt: buildMessages(userMessage),
            context: currentSystemContext,
            // Provider-specific extras
            inputQuota: event.usage.inputQuota,
            // Timing
            elapsed: {
              tokensFirst: firstTokenTime,
              tokensLast: Date.now() - startTime,
            },
          },
        };
      }
    }
  }

  /**
   * Reduce context by rebuilding with fewer chunks.
   */
  const reduceContext = async () => {
    if (!rawChunks?.length || currentChunkCount <= MIN_CONTEXT_CHUNKS) {
      return false;
    }

    const targetChunks = Math.max(
      Math.floor(currentChunkCount / 2),
      MIN_CONTEXT_CHUNKS,
    );

    try {
      const result = await rebuildContextWithLimit({
        chunks: rawChunks,
        query: initialQuery,
        provider,
        model,
        targetChunkCount: targetChunks,
      });

      currentSystemContext = result.context;
      currentChunkCount = result.chunkCount;
      currentTokenBreakdown = result.tokenBreakdown;
      return true;
    } catch (err) {
      console.warn("Failed to reduce context:", err); // eslint-disable-line no-undef
      return false;
    }
  };

  return {
    /**
     * Start a new conversation with RAG search.
     * @param {string} query - User's initial query
     * @param {Object} searchOptions - Search filter options
     * @yields {{ type: "search" | "data" | "finishReason" | "usage" | "done", message: any }}
     */
    async *start(
      query,
      { postType = [], minDate = "", categoryPrimary = [] } = {},
    ) {
      if (destroyed) throw new Error("Session destroyed");

      // Reset state for new conversation
      if (handler) {
        handler.destroy?.();
        handler = null;
      }
      searchData = null;
      history.length = 0;
      totalInputTokens = 0;
      totalOutputTokens = 0;

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
      const contextResult = await buildContextFromChunks({
        chunks,
        query,
        provider,
        model,
        forMultiTurn: capabilities.supportsMultiTurn,
        isFirstTurn: true,
      });

      currentSystemContext = contextResult.context;
      currentChunkCount = contextResult.chunkCount;
      currentTokenBreakdown = contextResult.tokenBreakdown;
      rawChunks = chunks;
      initialQuery = query;

      metadata.context = contextResult.context;
      metadata.contextChunkCount = contextResult.chunkCount;
      metadata.contextTokenEstimate = contextResult.tokenEstimate;
      metadata.contextTokens = contextResult.tokenBreakdown;

      // Store search data
      searchData = {
        posts: fetchedPosts,
        chunks,
        metadata,
        displayPosts: searchResultsToPosts({ posts: fetchedPosts, chunks }),
      };

      // Yield search results for UI
      yield {
        type: "search",
        message: searchData,
      };

      // Step 3: Stream first message
      for await (const event of streamMessage(query, startTime)) {
        if (event.type === "usage") {
          // Add search elapsed time to usage
          yield {
            type: "usage",
            message: {
              ...event.message,
              elapsed: {
                ...metadata.elapsed,
                ...event.message.elapsed,
              },
            },
          };
        } else {
          yield event;
        }
      }

      yield { type: "done", message: null };
    },

    /**
     * Continue the conversation with a follow-up message.
     * @param {string} query - User's follow-up query
     * @yields {{ type: "data" | "finishReason" | "usage" | "done", message: any }}
     */
    async *continue(query) {
      if (destroyed) throw new Error("Session destroyed");
      if (history.length === 0) {
        throw new Error("No conversation started. Call start() first.");
      }

      if (!checkCanContinue()) {
        const msg =
          "This conversation has reached its token limit. Please start a new conversation.";
        if (THROW_ON_TOKEN_LIMIT) throw new Error(msg);
        console.warn(msg); // eslint-disable-line no-undef
      }

      const startTime = Date.now();

      for await (const event of streamMessage(query, startTime)) {
        yield event;
      }

      yield { type: "done", message: null };
    },

    getCapabilities: () => ({ ...capabilities }),
    canContinue: () => history.length === 0 || checkCanContinue(),
    getSearchData: () => searchData,
    getModel: () => ({ provider, model }),
    getTokenUsage,
    getHistory: () => [...history],
    reduceContext,

    destroy() {
      destroyed = true;
      handler?.destroy?.();
      handler = null;
      searchData = null;
      history.length = 0;
    },
  };
};

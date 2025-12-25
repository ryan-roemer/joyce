// Chat Session - Unified API for RAG-based conversations
// Encapsulates: search → context building → provider dispatch → messaging
// Merged from former chat-session.js (facade) and conversation-session.js

import { search } from "./search.js";
import {
  buildContextFromChunks,
  rebuildContextWithLimit,
  buildBasePrompts,
  BASE_TOKEN_ESTIMATE,
} from "./chat.js";
import { getProviderCapabilities } from "./llm.js";
import { searchResultsToPosts } from "../../../app/data/util.js";
import { estimateTokens } from "../util.js";
import {
  createPromptSession,
  sendPromptMessage,
  sendWriterMessage,
} from "./providers/chrome.js";
import {
  createSession as createWebLlmSession,
  sendMessage as sendWebLlmMessage,
} from "./providers/web-llm.js";
import {
  getModelCfg,
  MIN_CONTEXT_CHUNKS,
  THROW_ON_TOKEN_LIMIT,
  MAX_OUTPUT_TOKENS,
} from "../../../config.js";

// Set to true to enable detailed token debugging in console
const DEBUG_TOKENS = false;

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
 * This unified abstraction handles the entire conversation lifecycle:
 * 1. RAG search to find relevant content
 * 2. Context building from search chunks
 * 3. Provider-specific session management
 * 4. Message streaming with token tracking
 * 5. Multi-turn conversation support (where provider allows)
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
  let tokensUsed = 0;

  // Context state (for multi-turn context reduction)
  let currentSystemContext = "";
  let currentChunkCount = 0;
  let currentTokenBreakdown = null;
  let rawChunks = [];
  let initialQuery = "";

  // Provider-specific session handle (for Chrome Prompt API session reuse)
  let providerSession = null;

  // Token tracking state
  let lastInputTokens = 0;
  let totalOutputTokens = 0;
  let aggregatePromptTokens = 0;
  let aggregateCompletionTokens = 0;

  /**
   * Build contextTokens object for usage events.
   * Recalculates query tokens for the current turn's message.
   * @param {string} userMessage - The current turn's user message
   * @returns {Object|null} contextTokens object or null if breakdown unavailable
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
   * @returns {{ used: number, available: number, limit: number }}
   */
  const getTokenUsage = () => {
    const available = Math.max(0, maxTokens - tokensUsed);
    return { used: tokensUsed, available, limit: maxTokens };
  };

  /**
   * Check if we can continue before sending a message.
   * @returns {boolean}
   */
  const checkCanContinue = () => {
    // Single-turn providers can't continue after first message
    if (!capabilities.supportsMultiTurn && history.length > 0) {
      return false;
    }
    // Check if we have enough tokens for another exchange
    const { available } = getTokenUsage();
    return available > MIN_TOKENS_FOR_EXCHANGE;
  };

  /**
   * Send message using Chrome Prompt API with session reuse.
   * @param {string} userMessage - The user's message
   * @yields {{ type: "data" | "finishReason" | "usage", message: any }}
   */
  async function* sendChromePrompt(userMessage) {
    // Lazy create Chrome session on first message
    if (!providerSession) {
      providerSession = await createPromptSession({
        systemContext: currentSystemContext,
        temperature,
      });
    }

    let assistantContent = "";

    for await (const event of sendPromptMessage(providerSession, userMessage)) {
      if (event.type === "data") {
        assistantContent += event.message;
        yield event;
      } else if (event.type === "finishReason") {
        yield event;
      } else if (event.type === "usage") {
        // Calculate per-turn delta from tracked cumulative
        const thisInputTokens =
          event.message.totalInputTokens - lastInputTokens;
        lastInputTokens = event.message.totalInputTokens;

        // Update cumulative output token tracking
        totalOutputTokens += event.message.outputTokens;
        tokensUsed = event.message.totalInputTokens + totalOutputTokens;

        const turnNumber = Math.ceil((history.length + 1) / 2);
        const promptMessages = [
          ...buildBasePrompts(currentSystemContext),
          ...history,
          { role: "user", content: userMessage },
        ];

        yield {
          type: "usage",
          message: {
            inputTokens: thisInputTokens,
            outputTokens: event.message.outputTokens,
            totalInputTokens: event.message.totalInputTokens,
            totalOutputTokens,
            totalTokens: tokensUsed,
            available: getTokenUsage().available,
            limit: maxTokens,
            inputQuota: event.message.inputQuota,
            turnNumber,
            contextTokens: buildContextTokens(userMessage),
            prompt: promptMessages,
            context: currentSystemContext,
          },
        };
      }
    }

    // Add to history AFTER streaming completes successfully.
    // If streaming throws, history remains unchanged (intentional).
    history.push({ role: "user", content: userMessage });
    history.push({ role: "assistant", content: assistantContent });
  }

  /**
   * Send message using Chrome Writer API (single-turn only).
   * @param {string} userMessage - The user's message/writing task
   * @yields {{ type: "data" | "finishReason" | "usage", message: any }}
   */
  async function* sendChromeWriter(userMessage) {
    let assistantContent = "";

    for await (const event of sendWriterMessage({
      sharedContext: currentSystemContext,
      writingTask: userMessage,
    })) {
      if (event.type === "data") {
        assistantContent += event.message;
        yield event;
      } else if (event.type === "finishReason") {
        yield event;
      } else if (event.type === "usage") {
        tokensUsed = event.message.totalTokens;
        const turnNumber = 1;
        const promptMessages = [
          ...buildBasePrompts(currentSystemContext),
          { role: "user", content: userMessage },
        ];

        yield {
          type: "usage",
          message: {
            inputTokens: event.message.inputTokens,
            outputTokens: event.message.outputTokens,
            totalInputTokens: event.message.inputTokens,
            totalOutputTokens: event.message.outputTokens,
            totalTokens: event.message.totalTokens,
            available: getTokenUsage().available,
            limit: maxTokens,
            inputQuota: event.message.inputQuota,
            turnNumber,
            contextTokens: buildContextTokens(userMessage),
            prompt: promptMessages,
            context: currentSystemContext,
          },
        };
      }
    }

    // Add to history
    history.push({ role: "user", content: userMessage });
    history.push({ role: "assistant", content: assistantContent });
  }

  /**
   * Send message using web-llm with multi-turn support.
   * @param {string} userMessage - The user's message
   * @yields {{ type: "data" | "finishReason" | "usage", message: any }}
   */
  async function* sendWebLlm(userMessage) {
    // Create session if needed (web-llm sessions are lightweight)
    if (!providerSession) {
      providerSession = await createWebLlmSession({
        model,
        temperature,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
    }

    // Build full messages array: system context + history + current message
    const messages = [
      ...buildBasePrompts(currentSystemContext),
      ...history,
      { role: "user", content: userMessage },
    ];

    if (DEBUG_TOKENS) {
      const contentLength = messages.reduce(
        (acc, m) => acc + m.content.length,
        0,
      );
      const estimatedInputTokens = messages.reduce((acc, m) => {
        const hasMarkup = m.content.includes("<CHUNK>");
        return acc + estimateTokens(m.content, hasMarkup);
      }, 0);
      // eslint-disable-next-line no-undef
      console.log(
        "DEBUG(TOKENS) web-llm sendWebLlm - pre-stream context:",
        JSON.stringify(
          {
            messageCounts: {
              basePrompts: buildBasePrompts(currentSystemContext).length,
              history: history.length,
              total: messages.length,
            },
            currentChunkCount,
            estimated: { inputTokens: estimatedInputTokens, contentLength },
          },
          null,
          2,
        ),
      );
    }

    let assistantContent = "";

    for await (const event of sendWebLlmMessage(providerSession, messages)) {
      if (event.type === "data") {
        assistantContent += event.message;
        yield event;
      } else if (event.type === "finishReason") {
        yield event;
      } else if (event.type === "usage") {
        aggregatePromptTokens += event.message.inputTokens;
        aggregateCompletionTokens += event.message.outputTokens;
        tokensUsed = aggregatePromptTokens + aggregateCompletionTokens;

        const turnNumber = Math.ceil((history.length + 2) / 2);

        if (DEBUG_TOKENS) {
          // eslint-disable-next-line no-undef
          console.log(
            "DEBUG(TOKENS)(ACTUALS) web-llm sendWebLlm:",
            JSON.stringify(
              {
                thisTurn: {
                  promptTokens: event.message.inputTokens,
                  completionTokens: event.message.outputTokens,
                },
                cumulative: {
                  promptTokens: aggregatePromptTokens,
                  completionTokens: aggregateCompletionTokens,
                  total: tokensUsed,
                },
                turnNumber,
              },
              null,
              2,
            ),
          );
        }

        yield {
          type: "usage",
          message: {
            inputTokens: event.message.inputTokens,
            outputTokens: event.message.outputTokens,
            totalInputTokens: aggregatePromptTokens,
            totalOutputTokens: aggregateCompletionTokens,
            totalTokens: tokensUsed,
            available: getTokenUsage().available,
            limit: maxTokens,
            turnNumber,
            contextTokens: buildContextTokens(userMessage),
            prompt: messages,
            context: currentSystemContext,
          },
        };
      }
    }

    // Add to history
    history.push({ role: "user", content: userMessage });
    history.push({ role: "assistant", content: assistantContent });
  }

  /**
   * Dispatch message to appropriate provider.
   * @param {string} userMessage - The user's message
   * @yields {{ type: "data" | "finishReason" | "usage", message: any }}
   */
  async function* dispatchMessage(userMessage) {
    if (provider === "chrome" && capabilities.supportsMultiTurn) {
      yield* sendChromePrompt(userMessage);
    } else if (provider === "chrome") {
      // Writer API - single-turn only
      if (history.length > 0) {
        throw new Error(
          "Follow-up questions are not supported with the Writer API. " +
            "Please start a new conversation or switch to the Prompt API model.",
        );
      }
      yield* sendChromeWriter(userMessage);
    } else if (provider === "webLlm") {
      yield* sendWebLlm(userMessage);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Reduce context by rebuilding with fewer chunks.
   * @returns {Promise<boolean>} Whether reduction was successful
   */
  const reduceContext = async () => {
    if (!rawChunks?.length || currentChunkCount <= MIN_CONTEXT_CHUNKS) {
      return false;
    }

    const targetChunks = Math.max(
      Math.floor(currentChunkCount / 2),
      MIN_CONTEXT_CHUNKS,
    );

    if (DEBUG_TOKENS) {
      // eslint-disable-next-line no-undef
      console.log(
        "DEBUG(TOKENS) reduceContext:",
        JSON.stringify({ currentChunkCount, targetChunks }, null, 2),
      );
    }

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
      // eslint-disable-next-line no-undef
      console.warn("Failed to reduce context:", err);
      return false;
    }
  };

  return {
    /**
     * Start a new conversation with RAG search.
     *
     * Performs:
     * 1. RAG search for relevant content
     * 2. Context building from chunks
     * 3. First message streaming
     *
     * @param {string} query - User's initial query
     * @param {Object} searchOptions - Search filter options
     * @param {string[]} searchOptions.postType - Post types to filter
     * @param {string} searchOptions.minDate - Minimum date filter
     * @param {string[]} searchOptions.categoryPrimary - Categories to filter
     * @yields {{ type: "search" | "data" | "finishReason" | "usage" | "done", message: any }}
     */
    async *start(
      query,
      { postType = [], minDate = "", categoryPrimary = [] } = {},
    ) {
      if (destroyed) {
        throw new Error("Session destroyed");
      }

      // Reset state for new conversation
      if (providerSession) {
        providerSession.destroy?.();
        providerSession = null;
      }
      searchData = null;
      history.length = 0;
      tokensUsed = 0;
      lastInputTokens = 0;
      totalOutputTokens = 0;
      aggregatePromptTokens = 0;
      aggregateCompletionTokens = 0;

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
        message: {
          posts: fetchedPosts,
          chunks,
          metadata,
          displayPosts: searchData.displayPosts,
        },
      };

      // Step 3: Send first message
      let firstTokenTime = null;

      for await (const event of dispatchMessage(query)) {
        if (event.type === "data") {
          if (firstTokenTime === null) {
            firstTokenTime = Date.now() - startTime;
          }
          yield event;
        } else if (event.type === "finishReason") {
          yield event;
        } else if (event.type === "usage") {
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
     * Uses the existing context from start().
     * Follow-up queries don't trigger new RAG searches.
     *
     * @param {string} query - User's follow-up query
     * @yields {{ type: "data" | "finishReason" | "usage" | "done", message: any }}
     */
    async *continue(query) {
      if (destroyed) {
        throw new Error("Session destroyed");
      }

      if (history.length === 0) {
        throw new Error("No conversation started. Call start() first.");
      }

      // Check token limit
      // TODO(UI): Surface token limit warning in UI before it's hit, not just after.
      // Currently warns in console but proceeds, which may cause API errors.
      if (!checkCanContinue()) {
        const msg =
          "This conversation has reached its token limit. Please start a new conversation.";
        if (THROW_ON_TOKEN_LIMIT) {
          throw new Error(msg);
        }
        // eslint-disable-next-line no-undef
        console.warn(msg);
      }

      const startTime = Date.now();
      let firstTokenTime = null;

      for await (const event of dispatchMessage(query)) {
        if (event.type === "data") {
          if (firstTokenTime === null) {
            firstTokenTime = Date.now() - startTime;
          }
          yield event;
        } else if (event.type === "finishReason") {
          yield event;
        } else if (event.type === "usage") {
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
      if (history.length === 0) {
        return true; // Not started yet, can start
      }
      return checkCanContinue();
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
     * Get current token usage.
     * @returns {{ used: number, available: number, limit: number }}
     */
    getTokenUsage,

    /**
     * Get conversation history.
     * @returns {Array<{role: string, content: string}>}
     */
    getHistory() {
      return [...history];
    },

    /**
     * Reduce context (for advanced use).
     * @returns {Promise<boolean>}
     */
    reduceContext,

    /**
     * Clean up session resources.
     */
    destroy() {
      destroyed = true;
      if (providerSession) {
        providerSession.destroy?.();
        providerSession = null;
      }
      searchData = null;
      history.length = 0;
    },
  };
};

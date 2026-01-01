// Chat Session - Unified API for RAG-based conversations
// Simplified architecture: RAG → Session → Provider

import { getProviderCapabilities } from "./llm.js";
import { estimateTokens } from "../util.js";
import { createHandler as createChromeHandler } from "./providers/chrome.js";
import { createHandler as createWebLlmHandler } from "./providers/web-llm.js";
import { buildBasePrompts, BASE_TOKEN_ESTIMATE } from "./chat.js";
import { performRagSearch, reduceContext as ragReduceContext } from "./rag.js";
import {
  getModelCfg,
  THROW_ON_TOKEN_LIMIT,
  MAX_OUTPUT_TOKENS,
} from "../../../config.js";

// Minimum tokens needed for a meaningful exchange
const MIN_TOKENS_FOR_EXCHANGE = 500;

// ============================================================================
// State Factory
// ============================================================================

/**
 * Create session state with all variables and simple mutators.
 */
const createSessionState = ({ maxTokens, supportsMultiTurn }) => {
  const state = {
    // Core state
    destroyed: false,
    searchData: null,
    handler: null,

    // Token tracking
    totalInputTokens: 0,
    totalOutputTokens: 0,

    // Conversation history
    history: [],

    // Context state (from RAG)
    contextState: null,

    // Computed properties
    get context() {
      return state.contextState?.context ?? "";
    },
    get chunkCount() {
      return state.contextState?.chunkCount ?? 0;
    },
    get tokenBreakdown() {
      return state.contextState?.tokenBreakdown ?? null;
    },

    // Token usage
    getTokenUsage() {
      const used = state.totalInputTokens + state.totalOutputTokens;
      const available = Math.max(0, maxTokens - used);
      return { used, available, limit: maxTokens };
    },

    canContinue() {
      if (!supportsMultiTurn && state.history.length > 0) {
        return false;
      }
      return state.getTokenUsage().available > MIN_TOKENS_FOR_EXCHANGE;
    },

    // Mutators
    addTurn(userMessage, assistantContent, inputTokens, outputTokens) {
      state.history.push({ role: "user", content: userMessage });
      state.history.push({ role: "assistant", content: assistantContent });
      state.totalInputTokens += inputTokens;
      state.totalOutputTokens += outputTokens;
    },

    reset() {
      if (state.handler) {
        state.handler.destroy?.();
        state.handler = null;
      }
      state.searchData = null;
      state.history = [];
      state.totalInputTokens = 0;
      state.totalOutputTokens = 0;
      state.contextState = null;
    },

    destroy() {
      state.destroyed = true;
      state.reset();
    },
  };

  return state;
};

// ============================================================================
// Usage Message Builder
// ============================================================================

/**
 * Build enriched usage message from provider event.
 */
const buildUsageMessage = ({
  event,
  state,
  userMessage,
  prompt,
  maxTokens,
  firstTokenTime,
  startTime,
}) => {
  const queryTokens = estimateTokens(userMessage);
  const contextTokens = state.tokenBreakdown
    ? {
        basePromptTokens: BASE_TOKEN_ESTIMATE,
        queryTokens,
        chunksTokens: state.tokenBreakdown.chunksTokens,
        chunkCount: state.chunkCount,
        totalTokens:
          BASE_TOKEN_ESTIMATE + state.tokenBreakdown.chunksTokens + queryTokens,
      }
    : null;

  return {
    // Per-turn tokens
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
    // Cumulative tokens
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
    totalTokens: state.totalInputTokens + state.totalOutputTokens,
    // Context info
    available: state.getTokenUsage().available,
    limit: maxTokens,
    turnNumber: Math.floor(state.history.length / 2),
    contextTokens,
    // Debug info
    prompt,
    context: state.context,
    // Provider-specific extras
    inputQuota: event.usage.inputQuota,
    // Timing
    elapsed: {
      tokensFirst: firstTokenTime,
      tokensLast: Date.now() - startTime,
    },
  };
};

// ============================================================================
// Chat Session Factory
// ============================================================================

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
  const capabilities = getProviderCapabilities(provider, model);
  const modelCfg = getModelCfg({ provider, model });
  const maxTokens = modelCfg.maxTokens ?? Infinity;

  const state = createSessionState({
    maxTokens,
    supportsMultiTurn: capabilities.supportsMultiTurn,
  });

  /**
   * Create provider handler lazily.
   */
  const ensureHandler = async () => {
    if (state.handler) return state.handler;

    state.handler =
      provider === "chrome"
        ? await createChromeHandler({
            model,
            systemContext: state.context,
            temperature,
          })
        : await createWebLlmHandler({
            model,
            temperature,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          });

    return state.handler;
  };

  /**
   * Build messages for web-llm (stateless provider).
   */
  const buildMessages = (userMessage) => [
    ...buildBasePrompts(state.context),
    ...state.history,
    { role: "user", content: userMessage },
  ];

  /**
   * Stream message through provider with enriched events.
   */
  async function* streamMessage(query, startTime) {
    // Writer API check
    if (
      provider === "chrome" &&
      !capabilities.supportsMultiTurn &&
      state.history.length > 0
    ) {
      throw new Error(
        "Follow-up questions are not supported with the Writer API. " +
          "Please start a new conversation or switch to the Prompt API model.",
      );
    }

    const handler = await ensureHandler();
    const input = provider === "webLlm" ? buildMessages(query) : query;
    let firstTokenTime = null;

    for await (const event of handler.sendMessage(input)) {
      if (event.type === "data") {
        if (firstTokenTime === null) {
          firstTokenTime = Date.now() - startTime;
        }
        yield { type: "data", message: event.content };
      } else if (event.type === "done") {
        // Update state
        state.addTurn(
          query,
          event.usage.assistantContent,
          event.usage.inputTokens,
          event.usage.outputTokens,
        );

        yield { type: "finishReason", message: event.finishReason };
        yield {
          type: "usage",
          message: buildUsageMessage({
            event,
            state,
            userMessage: query,
            prompt: buildMessages(query),
            maxTokens,
            firstTokenTime,
            startTime,
          }),
        };
      }
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  return {
    /**
     * Start a new conversation with RAG search.
     */
    async *start(
      query,
      { postType = [], minDate = "", categoryPrimary = [] } = {},
    ) {
      if (state.destroyed) throw new Error("Session destroyed");

      state.reset();
      const startTime = Date.now();

      // RAG search + context building (extracted to rag.js)
      const { searchData, contextState } = await performRagSearch({
        query,
        filters: { postType, minDate, categoryPrimary },
        provider,
        model,
        supportsMultiTurn: capabilities.supportsMultiTurn,
      });

      state.searchData = searchData;
      state.contextState = contextState;

      yield { type: "search", message: searchData };

      // Stream first message
      for await (const event of streamMessage(query, startTime)) {
        if (event.type === "usage") {
          // Merge search elapsed time
          yield {
            type: "usage",
            message: {
              ...event.message,
              elapsed: {
                ...searchData.metadata.elapsed,
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
     * Continue conversation with follow-up.
     */
    async *continue(query) {
      if (state.destroyed) throw new Error("Session destroyed");
      if (state.history.length === 0) {
        throw new Error("No conversation started. Call start() first.");
      }

      if (!state.canContinue()) {
        const msg =
          "This conversation has reached its token limit. Please start a new conversation.";
        if (THROW_ON_TOKEN_LIMIT) throw new Error(msg);
        console.warn(msg); // eslint-disable-line no-undef
      }

      const startTime = Date.now();
      yield* streamMessage(query, startTime);
      yield { type: "done", message: null };
    },

    // Getters
    getCapabilities: () => ({ ...capabilities }),
    canContinue: () => state.history.length === 0 || state.canContinue(),
    getSearchData: () => state.searchData,
    getModel: () => ({ provider, model }),
    getTokenUsage: () => state.getTokenUsage(),
    getHistory: () => [...state.history],

    // Context reduction
    async reduceContext() {
      if (!state.contextState) return false;
      const newContextState = await ragReduceContext({
        contextState: state.contextState,
        provider,
        model,
      });
      if (newContextState) {
        state.contextState = newContextState;
        return true;
      }
      return false;
    },

    destroy: () => state.destroy(),
  };
};

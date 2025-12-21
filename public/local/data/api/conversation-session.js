// Conversation Session Abstraction
// Manages multi-round conversations with token tracking across providers
// See plan: Multi-Round Conversation Abstraction

import { getProviderCapabilities } from "./llm.js";
import { getModelCfg, TOKEN_CUSHION_CHAT } from "../../../config.js";

/**
 * TOKEN TRACKING CAPABILITY
 *
 * When `supportsTokenTracking` is TRUE (current providers):
 * - Chrome APIs: Use `measureInputUsage()` and `inputUsage` properties
 * - web-llm: Use `usage` object from response (prompt_tokens, completion_tokens)
 * - Token counts are accurate and include all context (system, history, RAG)
 *
 * When `supportsTokenTracking` is FALSE (future fallback):
 * - Use `estimateTokens()` from util.js (~4 chars per token heuristic)
 * - Only measures NEW message content, not full context
 * - Will UNDERCOUNT actual usage because it misses:
 *   - System prompts (repeated each turn for stateless providers)
 *   - Full conversation history
 *   - RAG context chunks
 *
 * FALLBACK MITIGATIONS:
 * 1. Track full history tokens: Estimate ALL history content, not just delta
 * 2. Larger safety buffer: Use 1000+ token buffer instead of 500
 * 3. Conservative canContinue(): Return false earlier when uncertain
 *
 * IMPLEMENTATION PATTERN (for sendMessage):
 * ```
 * if (capabilities.supportsTokenTracking && usage) {
 *   tokensUsed += usage.prompt_tokens + usage.completion_tokens;
 * } else {
 *   // Fallback: estimate from content (less accurate)
 *   const inputEstimate = estimateTokens(userMessage);
 *   const outputEstimate = estimateTokens(assistantContent);
 *   tokensUsed += inputEstimate + outputEstimate;
 *   // TODO: Also estimate system context + history for accuracy
 * }
 * ```
 */

// Minimum tokens needed for a meaningful exchange (question + response)
const MIN_TOKENS_FOR_EXCHANGE = 500;

/**
 * Error thrown when a conversation exceeds its token limit.
 */
export class ConversationLimitError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} details - Token details
   * @param {number} details.tokensUsed - Tokens used so far
   * @param {number} details.tokensLimit - Maximum tokens allowed
   */
  constructor(message, { tokensUsed, tokensLimit }) {
    super(message);
    this.name = "ConversationLimitError";
    this.tokensUsed = tokensUsed;
    this.tokensLimit = tokensLimit;
  }
}

/**
 * @typedef {Object} TokenUsage
 * @property {number} used - Total tokens used so far
 * @property {number} available - Tokens available for next turn
 * @property {number} limit - Maximum tokens for this model
 */

/**
 * @typedef {Object} Capabilities
 * @property {boolean} supportsMultiTurn - Can handle conversation history
 * @property {boolean} supportsTokenTracking - Reports accurate token usage
 */

/**
 * @typedef {Object} ConversationSession
 * @property {function(string): AsyncGenerator} sendMessage - Send message, stream response
 * @property {function(): TokenUsage} getTokenUsage - Get current token usage
 * @property {function(): Array<{role: string, content: string}>} getHistory - Get conversation history
 * @property {function(): boolean} canContinue - Check if more turns are possible
 * @property {function(): Capabilities} getCapabilities - Get provider capabilities
 * @property {function(): void} destroy - Clean up session resources
 */

/**
 * Create a conversation session for multi-round chat.
 *
 * Design decisions:
 * - RAG context is pre-fetched by caller and passed as systemContext
 * - Follow-up messages reuse the same context (no new searches)
 * - Single-turn providers (Writer API) show UI messaging about limitation
 *
 * @param {Object} options
 * @param {string} options.provider - Provider key ("webLlm" | "chrome")
 * @param {string} options.model - Model ID
 * @param {number} options.temperature - Sampling temperature
 * @param {string} options.systemContext - RAG context (XML chunks from caller)
 * @returns {Promise<ConversationSession>}
 */
export const createConversationSession = async ({
  provider,
  model,
  temperature,
  systemContext,
}) => {
  // Get model config and capabilities
  const modelCfg = getModelCfg({ provider, model });
  const capabilities = getProviderCapabilities(provider, model);
  const maxTokens = modelCfg.maxTokens ?? Infinity;

  // Internal state
  const history = []; // { role, content }[]
  let tokensUsed = 0;
  let destroyed = false;

  // Provider-specific session handle (for Chrome Prompt API session reuse)
  // Will be populated by provider-specific implementations in future phases
  let providerSession = null;

  // Store options for provider implementations
  const sessionOptions = {
    provider,
    model,
    temperature,
    systemContext,
  };

  return {
    /**
     * Send a message and get streaming response.
     * @param {string} userMessage - The user's message
     * @yields {{ type: "data" | "usage" | "done", message: any }}
     */
    async *sendMessage(userMessage) {
      if (destroyed) {
        throw new Error("Session destroyed");
      }

      // Check if we can continue before sending
      if (!this.canContinue()) {
        throw new ConversationLimitError(
          "This conversation has reached its token limit. Please start a new conversation.",
          { tokensUsed, tokensLimit: maxTokens },
        );
      }

      // Add user message to history
      history.push({ role: "user", content: userMessage });

      // TODO: Provider-specific implementation in future phases
      // For now, yield a placeholder indicating implementation pending
      // This skeleton establishes the interface; actual LLM calls come later

      // Placeholder: echo for testing the interface
      const placeholderResponse = `[Session skeleton] Would send: "${userMessage}" to ${provider}/${model}`;
      history.push({ role: "assistant", content: placeholderResponse });

      yield { type: "data", message: placeholderResponse };
      yield { type: "usage", message: this.getTokenUsage() };
      yield { type: "done", message: null };
    },

    /**
     * Get current token usage.
     * @returns {TokenUsage}
     */
    getTokenUsage() {
      const available = Math.max(
        0,
        maxTokens - TOKEN_CUSHION_CHAT - tokensUsed,
      );
      return { used: tokensUsed, available, limit: maxTokens };
    },

    /**
     * Get conversation history.
     * @returns {Array<{role: string, content: string}>}
     */
    getHistory() {
      return [...history];
    },

    /**
     * Check if the conversation can continue with more turns.
     * @returns {boolean}
     */
    canContinue() {
      // Single-turn providers can't continue after first message
      if (!capabilities.supportsMultiTurn && history.length > 0) {
        return false;
      }

      const { available } = this.getTokenUsage();
      // Need minimum tokens for a meaningful exchange
      return available > MIN_TOKENS_FOR_EXCHANGE;
    },

    /**
     * Get provider capabilities.
     * @returns {Capabilities}
     */
    getCapabilities() {
      return { ...capabilities };
    },

    /**
     * Clean up session resources.
     */
    destroy() {
      destroyed = true;
      providerSession?.destroy?.();
      providerSession = null;
    },

    // Expose internal state for provider implementations (not part of public API)
    // These will be used by provider-specific code in future phases
    _internal: {
      get history() {
        return history;
      },
      get tokensUsed() {
        return tokensUsed;
      },
      set tokensUsed(value) {
        tokensUsed = value;
      },
      get providerSession() {
        return providerSession;
      },
      set providerSession(value) {
        providerSession = value;
      },
      get sessionOptions() {
        return sessionOptions;
      },
      get capabilities() {
        return capabilities;
      },
      get maxTokens() {
        return maxTokens;
      },
    },
  };
};

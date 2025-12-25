// Conversation Session Abstraction
// Manages multi-round conversations with token tracking across providers
// See plan: Multi-Round Conversation Abstraction

import { getProviderCapabilities } from "./llm.js";
import {
  createPromptSession,
  sendPromptMessage,
  sendWriterMessage,
} from "./providers/chrome.js";
import { getLlmEngine } from "./providers/web-llm.js";
import {
  buildBasePrompts,
  rebuildContextWithLimit,
  BASE_TOKEN_ESTIMATE,
} from "./chat.js";
import { estimateTokens } from "../util.js";
import {
  getModelCfg,
  MIN_CONTEXT_CHUNKS,
  THROW_ON_TOKEN_LIMIT,
  MAX_OUTPUT_TOKENS,
} from "../../../config.js";

// Set to true to enable detailed token debugging in console
const DEBUG_TOKENS = true;

/**
 * TOKEN TRACKING CAPABILITY
 *
 * PROVIDER BEHAVIOR:
 * - Chrome APIs: Use `inputUsage` property for cumulative input tokens
 * - web-llm: Use `usage` object from response (prompt_tokens, completion_tokens)
 *
 * Both providers use cumulative token tracking. We aggregate the API-reported
 * prompt_tokens and completion_tokens across all turns to track total usage.
 * The context window limit applies to this cumulative total.
 */

// Minimum tokens needed for a meaningful exchange (question + response)
const MIN_TOKENS_FOR_EXCHANGE = 500;

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
 * - For multi-turn providers, raw chunks are stored for dynamic context reduction
 *
 * @param {Object} options
 * @param {string} options.provider - Provider key ("webLlm" | "chrome")
 * @param {string} options.model - Model ID
 * @param {number} options.temperature - Sampling temperature
 * @param {string} options.systemContext - RAG context (XML chunks from caller)
 * @param {Array} [options.rawChunks] - Original search chunks for context reduction
 * @param {string} [options.initialQuery] - Initial query (for context rebuilding)
 * @param {number} [options.initialChunkCount] - Initial number of chunks used
 * @param {Object} [options.initialTokenBreakdown] - Initial token breakdown from context building
 * @returns {Promise<ConversationSession>}
 */
export const createConversationSession = async ({
  provider,
  model,
  temperature,
  systemContext,
  rawChunks = [],
  initialQuery = "",
  initialChunkCount = 0,
  initialTokenBreakdown = null,
}) => {
  // Get model config and capabilities
  const modelCfg = getModelCfg({ provider, model });
  const capabilities = getProviderCapabilities(provider, model);
  const maxTokens = modelCfg.maxTokens ?? Infinity;

  // Internal state
  const history = []; // { role, content }[]
  let tokensUsed = 0;
  let destroyed = false;

  // Context reduction state (for web-llm multi-turn)
  let currentSystemContext = systemContext;
  let currentChunkCount = initialChunkCount;
  // Token breakdown state - tracks base prompt, chunks, and will be updated per-turn with query tokens
  let currentTokenBreakdown = initialTokenBreakdown;

  // ============================================================================
  // Per-Turn Token Delta Tracking
  // ============================================================================
  // Chrome's session.inputUsage behaves unexpectedly for delta calculations:
  // - BEFORE promptStreaming(): inputUsage includes initialPrompts tokens (~6000)
  // - AFTER promptStreaming(): inputUsage may DECREASE or reset to a smaller value
  //
  // This causes before/after delta calculations to produce NEGATIVE values.
  //
  // SOLUTION: Track cumulative tokens ourselves and calculate deltas from our
  // tracked values, using Chrome's post-streaming inputUsage as the authoritative
  // cumulative count.
  //
  // - lastInputTokens: Our tracked cumulative input tokens from previous turns
  // - totalOutputTokens: Our tracked cumulative output tokens across all turns
  // - Delta = currentCumulative - lastTracked
  // ============================================================================
  let lastInputTokens = 0;
  let totalOutputTokens = 0;

  // Aggregate tracking for DEBUG(TOKENS)(ACTUALS) logging
  let aggregatePromptTokens = 0;
  let aggregateCompletionTokens = 0;
  let aggregateTotalTokens = 0;

  // Provider-specific session handle (for Chrome Prompt API session reuse)
  // Will be populated by provider-specific implementations in future phases
  let providerSession = null;

  // Store options for provider implementations
  const sessionOptions = {
    provider,
    model,
    temperature,
    get systemContext() {
      return currentSystemContext;
    },
    rawChunks,
    initialQuery,
  };

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

  return {
    /**
     * Send a message and get streaming response.
     * Dispatches to provider-specific implementation based on provider type.
     * @param {string} userMessage - The user's message
     * @yields {{ type: "data" | "usage" | "done", message: any }}
     */
    async *sendMessage(userMessage) {
      if (destroyed) {
        throw new Error("Session destroyed");
      }

      // Check if we can continue before sending
      if (!this.canContinue()) {
        const msg =
          "This conversation has reached its token limit. Please start a new conversation.";
        if (THROW_ON_TOKEN_LIMIT) {
          throw new Error(msg);
        }
        console.warn(msg); // eslint-disable-line no-undef
        // Proceed anyway - let real API error happen
      }

      // Add user message to history
      history.push({ role: "user", content: userMessage });

      // Provider-specific dispatch
      if (provider === "chrome" && capabilities.supportsMultiTurn) {
        // Chrome Prompt API - session-based with automatic history
        yield* this._sendChromePrompt(userMessage);
      } else if (provider === "chrome") {
        // Chrome Writer API - single-turn only
        // history.length === 1 means just the user message we added (first message OK)
        // history.length > 1 means prior conversation exists (follow-ups blocked)
        if (history.length > 1) {
          history.pop(); // Remove the user message since we can't process it
          throw new Error(
            "Follow-up questions are not supported with the Writer API. " +
              "Please start a new conversation or switch to the Prompt API model.",
          );
        }
        yield* this._sendChromeWriter(userMessage);
      } else if (provider === "webLlm") {
        // Web-LLM with multi-turn support
        yield* this._sendWebLlm(userMessage);
      } else {
        throw new Error(`Unknown provider: ${provider}`);
      }
    },

    /**
     * Send message using Chrome Prompt API with session reuse.
     * Chrome sessions maintain conversation history internally.
     * @param {string} userMessage - The user's message
     * @yields {{ type: "data" | "usage" | "done", message: any }}
     * @private
     */
    async *_sendChromePrompt(userMessage) {
      // Lazy create Chrome session on first message
      if (!providerSession) {
        providerSession = await createPromptSession({
          systemContext: sessionOptions.systemContext,
          temperature: sessionOptions.temperature,
        });
      }

      let assistantContent = "";

      // Stream response from Chrome Prompt API
      for await (const event of sendPromptMessage(
        providerSession,
        userMessage,
      )) {
        if (event.type === "data") {
          assistantContent += event.message;
          yield event;
        } else if (event.type === "usage") {
          // ================================================================
          // Per-Turn Delta Calculation (Fixed)
          // ================================================================
          // Chrome's sendPromptMessage yields totalInputTokens (the cumulative
          // input count AFTER this turn). We calculate the per-turn delta by
          // comparing to our tracked lastInputTokens from the previous turn.
          //
          // This avoids the bug where Chrome's before/after inputUsage within
          // a single promptStreaming() call can produce negative deltas due to
          // unexpected Chrome behavior.
          // ================================================================
          const thisInputTokens =
            event.message.totalInputTokens - lastInputTokens;
          lastInputTokens = event.message.totalInputTokens;

          // Update cumulative output token tracking
          totalOutputTokens += event.message.outputTokens;
          tokensUsed = event.message.totalInputTokens + totalOutputTokens;

          // Calculate turn number (count of Q&A pairs, including current)
          // history has user message already, assistant will be added after
          const turnNumber = Math.ceil(history.length / 2);

          // Build prompt representation for Chrome Prompt API
          // Chrome maintains history internally, so we represent what was sent this turn
          const promptMessages = [
            ...buildBasePrompts(sessionOptions.systemContext),
            ...history, // Includes current user message
          ];

          // Yield rich usage data
          yield {
            type: "usage",
            message: {
              // Per-turn tokens (calculated from our tracked cumulative)
              inputTokens: thisInputTokens,
              outputTokens: event.message.outputTokens,
              // Cumulative tokens
              totalInputTokens: event.message.totalInputTokens,
              totalOutputTokens,
              totalTokens: tokensUsed,
              // Capacity
              available: this.getTokenUsage().available,
              limit: maxTokens,
              inputQuota: event.message.inputQuota,
              // Conversation info
              turnNumber,
              // Context info (recalculated per-turn)
              contextTokens: buildContextTokens(userMessage),
              // Full prompt and context for developer inspection
              prompt: promptMessages,
              context: sessionOptions.systemContext,
            },
          };
        }
      }

      // Add assistant response to history
      history.push({ role: "assistant", content: assistantContent });
      yield { type: "done", message: null };
    },

    /**
     * Send message using Chrome Writer API (single-turn only).
     * Writer API doesn't support multi-turn - each call is independent.
     * The systemContext (RAG chunks) is passed to Writer as sharedContext.
     *
     * @param {string} userMessage - The user's message/writing task
     * @yields {{ type: "data" | "usage" | "done", message: any }}
     * @private
     */
    async *_sendChromeWriter(userMessage) {
      let assistantContent = "";

      // Stream response from Chrome Writer API
      for await (const event of sendWriterMessage({
        sharedContext: sessionOptions.systemContext,
        writingTask: userMessage,
      })) {
        if (event.type === "data") {
          assistantContent += event.message;
          yield event;
        } else if (event.type === "usage") {
          // Writer API is single-turn, so all values are for this turn only
          // (no cumulative tracking needed)
          tokensUsed = event.message.totalTokens;

          // Turn number is always 1 for Writer API (single-turn)
          const turnNumber = 1;

          // Build prompt representation for Chrome Writer API
          // This matches what sendWriterMessage actually uses (buildBasePrompts + user message)
          const promptMessages = [
            ...buildBasePrompts(sessionOptions.systemContext),
            { role: "user", content: userMessage },
          ];

          yield {
            type: "usage",
            message: {
              // Per-turn tokens (same as total for single-turn)
              inputTokens: event.message.inputTokens,
              outputTokens: event.message.outputTokens,
              // Cumulative tokens (same as per-turn for single-turn)
              totalInputTokens: event.message.inputTokens,
              totalOutputTokens: event.message.outputTokens,
              totalTokens: event.message.totalTokens,
              // Capacity
              available: this.getTokenUsage().available,
              limit: maxTokens,
              inputQuota: event.message.inputQuota,
              // Conversation info
              turnNumber,
              // Context info (recalculated per-turn)
              contextTokens: buildContextTokens(userMessage),
              // Full prompt and context for developer inspection
              prompt: promptMessages,
              context: sessionOptions.systemContext,
            },
          };
        }
      }

      // Add assistant response to history (for display purposes)
      history.push({ role: "assistant", content: assistantContent });
      yield { type: "done", message: null };
    },

    /**
     * Send message using web-llm with multi-turn support.
     *
     * Web-LLM uses a stateless OpenAI-compatible API, so we must:
     * 1. Build full messages array each call: basePrompts + history + userMessage
     * 2. Track cumulative tokens ourselves
     * 3. Dynamically reduce context when approaching token limit
     *
     * NOTE: web-llm's `usage.prompt_tokens` reports actual tokens for each call.
     * We aggregate these API-reported values for cumulative tracking.
     * The estimatedInputTokens calculation is only used for debug logging comparison,
     * not for any actual behavior decisions.
     *
     * @param {string} userMessage - The user's message
     * @yields {{ type: "data" | "usage" | "done", message: any }}
     * @private
     */
    async *_sendWebLlm(userMessage) {
      const engine = await getLlmEngine(sessionOptions.model);

      // Build full messages array: system context + history + current message
      // history already contains prior user/assistant pairs (excluding current user message)
      // Note: history was already updated with userMessage in sendMessage() before dispatch
      const messages = [
        ...buildBasePrompts(sessionOptions.systemContext),
        ...history.slice(0, -1), // All history except current user message (already added)
        { role: "user", content: userMessage },
      ];

      // Calculate content metrics for cumulative token tracking
      const contentLength = messages.reduce(
        (acc, m) => acc + m.content.length,
        0,
      );
      // Use XML markup factor for messages containing RAG chunks
      const estimatedInputTokens = messages.reduce((acc, m) => {
        const hasMarkup = m.content.includes("<CHUNK>");
        return acc + estimateTokens(m.content, hasMarkup);
      }, 0);

      if (DEBUG_TOKENS) {
        // eslint-disable-next-line no-undef
        console.log(
          "DEBUG(TOKENS) web-llm _sendWebLlm - pre-stream context:",
          JSON.stringify(
            {
              messageCounts: {
                basePrompts: buildBasePrompts(sessionOptions.systemContext)
                  .length,
                history: history.length - 1,
                total: messages.length,
              },
              currentChunkCount,
              estimated: {
                inputTokens: estimatedInputTokens,
                contentLength,
              },
            },
            null,
            2,
          ),
        );
      }

      const stream = await engine.chat.completions.create({
        messages,
        temperature: sessionOptions.temperature,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        stream_options: { include_usage: true },
      });

      let assistantContent = "";
      let usage = null;

      for await (const chunk of stream) {
        if (chunk.choices[0]?.delta?.content) {
          const delta = chunk.choices[0].delta.content;
          assistantContent += delta;
          yield { type: "data", message: delta };
        }
        const finishReason = chunk.choices[0]?.finish_reason;
        if (finishReason) {
          yield { type: "finishReason", message: finishReason };
        }
        if (chunk.usage) {
          usage = chunk.usage;
          aggregatePromptTokens += chunk.usage.prompt_tokens ?? 0;
          aggregateCompletionTokens += chunk.usage.completion_tokens ?? 0;
          aggregateTotalTokens += chunk.usage.total_tokens ?? 0;
          if (DEBUG_TOKENS) {
            // eslint-disable-next-line no-undef
            console.log(
              "DEBUG(TOKENS)(ACTUALS) web-llm conversation-session.js:",
              JSON.stringify(
                {
                  current: chunk.usage,
                  aggregates: {
                    prompt_tokens: aggregatePromptTokens,
                    completion_tokens: aggregateCompletionTokens,
                    total_tokens: aggregateTotalTokens,
                  },
                },
                null,
                2,
              ),
            );
          }
        }
      }

      // Update cumulative token tracking using actual reported values
      if (usage) {
        // Use cumulative aggregates from actual API-reported values
        tokensUsed = aggregatePromptTokens + aggregateCompletionTokens;

        // Calculate turn number (count of Q&A pairs, including current)
        const turnNumber = Math.ceil(history.length / 2);

        if (DEBUG_TOKENS) {
          // eslint-disable-next-line no-undef
          console.log(
            "DEBUG(TOKENS) web-llm _sendWebLlm - usage (all values are actuals from API):",
            JSON.stringify(
              {
                thisTurn: {
                  promptTokens: usage.prompt_tokens,
                  completionTokens: usage.completion_tokens,
                },
                cumulative: {
                  promptTokens: aggregatePromptTokens,
                  completionTokens: aggregateCompletionTokens,
                  total: tokensUsed,
                },
                capacity: {
                  available: this.getTokenUsage().available,
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
            // Per-turn tokens from API
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,

            // Cumulative tokens (what matters for capacity)
            totalInputTokens: aggregatePromptTokens,
            totalOutputTokens: aggregateCompletionTokens,
            totalTokens: tokensUsed,

            // Capacity
            available: this.getTokenUsage().available,
            limit: maxTokens,

            // Conversation info
            turnNumber,

            // Context info (for display purposes)
            contextTokens: buildContextTokens(userMessage),

            // Full prompt and context for developer inspection
            prompt: messages,
            context: sessionOptions.systemContext,
          },
        };
      }

      history.push({ role: "assistant", content: assistantContent });
      yield { type: "done", message: null };
    },

    /**
     * Reduce context by rebuilding with fewer chunks.
     * Called when approaching token limit in multi-turn conversations.
     *
     * @returns {Promise<boolean>} Whether reduction was successful
     * @private
     */
    async _reduceContext() {
      if (
        !sessionOptions.rawChunks?.length ||
        currentChunkCount <= MIN_CONTEXT_CHUNKS
      ) {
        return false; // Can't reduce further
      }

      // Reduce to half, but not below minimum
      const targetChunks = Math.max(
        Math.floor(currentChunkCount / 2),
        MIN_CONTEXT_CHUNKS,
      );

      if (DEBUG_TOKENS) {
        // eslint-disable-next-line no-undef
        console.log(
          "DEBUG(TOKENS) _reduceContext:",
          JSON.stringify(
            {
              currentChunkCount,
              targetChunks,
              minChunks: MIN_CONTEXT_CHUNKS,
            },
            null,
            2,
          ),
        );
      }

      try {
        const result = await rebuildContextWithLimit({
          chunks: sessionOptions.rawChunks,
          query: sessionOptions.initialQuery,
          provider: sessionOptions.provider,
          model: sessionOptions.model,
          targetChunkCount: targetChunks,
        });

        currentSystemContext = result.context;
        currentChunkCount = result.chunkCount;
        // Update token breakdown with new chunk values (base prompt stays same)
        currentTokenBreakdown = result.tokenBreakdown;
        return true;
      } catch (err) {
        // eslint-disable-next-line no-undef
        console.warn("Failed to reduce context:", err);
        return false;
      }
    },

    /**
     * Get current token usage.
     * Uses cumulative tracking for all providers.
     * @returns {TokenUsage}
     */
    getTokenUsage() {
      const available = Math.max(0, maxTokens - tokensUsed);
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
     * Uses cumulative token tracking for all providers.
     * @returns {boolean}
     */
    canContinue() {
      // Single-turn providers can't continue after first message
      if (!capabilities.supportsMultiTurn && history.length > 0) {
        return false;
      }

      // Check if we have enough tokens for another exchange
      const { available } = this.getTokenUsage();
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
      get currentChunkCount() {
        return currentChunkCount;
      },
      get currentSystemContext() {
        return currentSystemContext;
      },
    },
  };
};

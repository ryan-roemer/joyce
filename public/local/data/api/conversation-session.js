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
  TOKEN_CUSHION_CHAT,
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
 * - Chrome APIs: Use `measureInputUsage()` and `inputUsage` properties
 * - web-llm: Use `usage` object from response (prompt_tokens, completion_tokens)
 *
 * ============================================================================
 * WEB-LLM KV-CACHE BEHAVIOR
 * ============================================================================
 * web-llm's MLC Engine uses KV-cache for performance optimization.
 *
 * References:
 * - web-llm GitHub: https://github.com/mlc-ai/web-llm
 * - MLC-LLM (underlying engine): https://github.com/mlc-ai/mlc-llm
 * - MLC-LLM KV-cache docs: https://llm.mlc.ai/docs/deploy/rest.html (see "prefix caching")
 *
 * NOTE: The behavior below was empirically observed and verified through testing.
 * The `prompt_tokens` reporting behavior is an implementation detail of MLC engine.
 * This fundamentally changes how token limits work for multi-turn conversations:
 *
 * HOW IT WORKS:
 * - The engine caches key-value pairs from previous prompts
 * - On subsequent calls, it reuses the cached prefix (system + context + history)
 * - `usage.prompt_tokens` reports only NEW tokens being processed
 * - CACHED TOKENS DO NOT COUNT AGAINST THE CONTEXT WINDOW
 *
 * OBSERVED BEHAVIOR (TinyLlama 2K context, 6 turns):
 * | Turn | Full Context Est. | prompt_tokens Reported | Worked? |
 * |------|-------------------|------------------------|---------|
 * |  1   | 985               | 877                    | Yes     |
 * |  2   | 1264              | 22                     | Yes     |
 * |  3   | 1415              | 25                     | Yes     |
 * |  4   | 1502              | 18                     | Yes     |
 * |  5   | 1589              | 18                     | Yes     |
 * |  6   | 1676              | 18                     | Yes     |
 *
 * KEY INSIGHT: Conversation worked at "2,316 cumulative tokens" on a 2K model
 * because only per-turn tokens (~18-25) count, not cumulative!
 *
 * TOKEN MODEL FOR WEB-LLM:
 * - Turn 1: Full context must fit (base + chunks + query + response)
 * - Turn 2+: Only NEW tokens need to fit (user message + assistant response)
 * - The KV-cache handles the rest transparently
 *
 * IMPLEMENTATION:
 * - Track per-turn tokens (prompt_tokens + completion_tokens) not cumulative
 * - canContinue() always returns true for web-llm (KV-cache handles history)
 * - getTokenUsage().available reflects per-turn capacity, not cumulative
 * - Context reduction is NOT needed (cached prefix doesn't consume capacity)
 *
 * ============================================================================
 * CHROME PROVIDER
 * ============================================================================
 * Chrome APIs work differently - they maintain session state and report
 * cumulative token usage. Standard cumulative tracking applies.
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
        // Note: Context reduction is NOT needed with KV-cache.
        // The cached prefix doesn't count against per-turn token limits.
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
     * 2. Track tokens ourselves (see KV-cache note below)
     * 3. Dynamically reduce context when approaching token limit
     *
     * KV-CACHE NOTE: web-llm's MLC engine caches prompt prefixes between calls.
     * This means `usage.prompt_tokens` may only report NEW tokens, not the full
     * prompt. We work around this by estimating tokens from message content
     * rather than relying on the API-reported prompt_tokens.
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

      // Calculate content metrics for token tracking and KV-cache diagnosis
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
          "DEBUG(TOKENS) web-llm _sendWebLlm - messages:",
          JSON.stringify(
            {
              basePromptsCount: buildBasePrompts(sessionOptions.systemContext)
                .length,
              historyCount: history.length - 1,
              totalMessagesCount: messages.length,
              currentChunkCount,
              // KV-cache diagnostic: if contentLength is large but API reports few tokens,
              // confirms web-llm is reusing cached prefix and only counting new tokens
              contentLength,
              estimatedTokensFromContent: estimatedInputTokens,
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

      // Update token tracking
      // IMPORTANT: web-llm uses KV-cache which changes how token limits work:
      // - prompt_tokens reports only NEW tokens being processed (not full context)
      // - Cached prefix tokens don't count against the context window for new requests
      // - The real constraint is: can THIS turn's tokens fit (new input + output)
      //
      // Therefore, we track:
      // - perTurnTokens: what matters for capacity (prompt_tokens + completion_tokens)
      // - cumulativeEstimate: for informational display only (doesn't affect capacity)
      if (usage) {
        // Track per-turn tokens (what actually matters with KV-cache)
        const perTurnInputTokens = usage.prompt_tokens;
        const perTurnOutputTokens = usage.completion_tokens;
        const perTurnTokens = perTurnInputTokens + perTurnOutputTokens;

        // Also track cumulative for informational purposes
        totalOutputTokens += usage.completion_tokens;
        // tokensUsed now reflects per-turn reality, not cumulative estimate
        tokensUsed = perTurnTokens;

        // Calculate turn number (count of Q&A pairs, including current)
        const turnNumber = Math.ceil(history.length / 2);

        if (DEBUG_TOKENS) {
          // KV-Cache Verification Experiment:
          // If ratio ≈ 1.0, confirms prompt_tokens = only new user message tokens
          // If ratio >> 1.0, prompt_tokens includes more than just user message
          const estimatedNewMessageTokens = estimateTokens(userMessage);
          const kvCacheRatio =
            estimatedNewMessageTokens > 0
              ? (usage.prompt_tokens / estimatedNewMessageTokens).toFixed(2)
              : "N/A";

          // Calculate discrepancy between full context estimate vs reported
          const discrepancy = estimatedInputTokens - usage.prompt_tokens;
          const discrepancyPct =
            usage.prompt_tokens > 0
              ? ((discrepancy / usage.prompt_tokens) * 100).toFixed(1)
              : "N/A";
          // eslint-disable-next-line no-undef
          console.log(
            "DEBUG(TOKENS) web-llm _sendWebLlm - usage:",
            JSON.stringify(
              {
                promptTokensReported: usage.prompt_tokens,
                estimatedNewMessageTokens,
                // KV-Cache indicator: ratio ≈ 1.0 means only new message counted
                // ratio >> 1.0 means more tokens were processed (no cache or partial cache)
                // NOTE: kvCacheActive will be FALSE on turn 1 (ratio ~50) because
                // the full context is processed on first turn. This is expected behavior.
                // KV-cache only activates on turn 2+ when prefix can be reused.
                kvCacheRatio,
                kvCacheActive: parseFloat(kvCacheRatio) < 2.0,
                estimatedFullContext: estimatedInputTokens,
                discrepancy,
                discrepancyPct: `${discrepancyPct}%`,
                completionTokens: usage.completion_tokens,
                totalOutputTokens,
                tokensUsed,
                available: this.getTokenUsage().available,
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
            // Per-turn tokens (actual tokens processed this turn due to KV-cache)
            inputTokens: perTurnInputTokens, // What API actually processed
            outputTokens: perTurnOutputTokens,
            totalTokens: perTurnTokens, // Per-turn total (input + output)

            // Informational: full context estimate (doesn't affect capacity with KV-cache)
            estimatedFullContext: estimatedInputTokens,
            cumulativeOutputTokens: totalOutputTokens,

            // Capacity (with KV-cache, nearly full window available each turn)
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
     * NOTE: This method is NOT currently called for web-llm because KV-cache
     * eliminates the need for context reduction - cached prefix tokens don't
     * count against per-turn capacity. Kept for potential future use with
     * other providers or if KV-cache behavior changes.
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
     *
     * For web-llm with KV-cache:
     * - tokensUsed reflects per-turn tokens (last turn's actual usage)
     * - available reflects how much space remains for the NEXT turn
     * - The context window is effectively "refreshed" each turn due to KV-cache
     *
     * @returns {TokenUsage}
     */
    getTokenUsage() {
      if (provider === "webLlm") {
        // With KV-cache, available space is nearly the full context window
        // minus a buffer for response tokens. The cached prefix doesn't count.
        const responseBuffer = 500; // Reserve space for assistant response
        const available = Math.max(0, maxTokens - responseBuffer);
        return { used: tokensUsed, available, limit: maxTokens };
      }

      // For other providers (Chrome), use cushion-based calculation
      const cushion = TOKEN_CUSHION_CHAT;
      const available = Math.max(0, maxTokens - cushion - tokensUsed);
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
     *
     * For web-llm with KV-cache:
     * - The cached prefix doesn't count against the context window
     * - Each turn only needs space for new input + output
     * - We can effectively always continue (KV-cache handles the history)
     *
     * For other providers:
     * - Standard cumulative token check applies
     *
     * @returns {boolean}
     */
    canContinue() {
      // Single-turn providers can't continue after first message
      if (!capabilities.supportsMultiTurn && history.length > 0) {
        return false;
      }

      // For web-llm with KV-cache, we can always continue
      // The cached prefix doesn't count against per-turn capacity
      if (provider === "webLlm") {
        return true;
      }

      // For other providers, check if we have enough tokens
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

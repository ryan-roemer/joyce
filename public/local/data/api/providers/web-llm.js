// web-llm provider implementation
// Check if model is cached using web-llm's built-in utility
// Internally uses browser Cache API or IndexedDB depending on config
// See: https://deepwiki.com/mlc-ai/web-llm/5.4-caching-and-performance
import { CreateMLCEngine, hasModelInCache } from "@mlc-ai/web-llm";
import { DEFAULT_CHAT_MODEL } from "../../../../config.js";

const DEFAULT_MODEL = DEFAULT_CHAT_MODEL.model;

// Map of model -> { enginePromise, progressCallback }
const engines = new Map();

/**
 * Set a progress callback for a specific model
 * @param {string} model - The model ID
 * @param {Function} cb - Progress callback function
 */
export const setLlmProgressCallback = (model, cb) => {
  if (!engines.has(model)) {
    engines.set(model, { enginePromise: null, progressCallback: null });
  }
  engines.get(model).progressCallback = cb;
};

/**
 * Get or create an LLM engine for a specific model
 * @param {string} model - The model ID
 * @returns {Promise<MLCEngine>} The engine instance
 */
export const getLlmEngine = async (model = DEFAULT_MODEL) => {
  if (!engines.has(model)) {
    engines.set(model, { enginePromise: null, progressCallback: null });
  }

  const entry = engines.get(model);
  if (!entry.enginePromise) {
    entry.enginePromise = CreateMLCEngine(model, {
      initProgressCallback: (progress) => {
        if (entry.progressCallback) {
          entry.progressCallback(progress);
        }
      },
    });
  }
  return entry.enginePromise;
};

/**
 * Check if a model is cached
 * @param {string} model - The model ID
 * @returns {Promise<boolean>} Whether the model is cached
 */
export const isLlmCached = async (model = DEFAULT_MODEL) => {
  return hasModelInCache(model);
};

/**
 * Get capabilities for a web-llm model.
 * @param {string} model - The model ID (unused, all web-llm models have same capabilities)
 * @returns {{ supportsMultiTurn: boolean, supportsTokenTracking: boolean }}
 */
// eslint-disable-next-line no-unused-vars
export const getCapabilities = (model) => ({
  supportsMultiTurn: true, // Web-LLM multi-turn via stateless message history
  supportsTokenTracking: true, // usage object in response
});

// ============================================================================
// Unified Provider Interface
// ============================================================================

/**
 * Create a conversation handler for web-llm.
 * Web-LLM is stateless - history must be passed to sendMessage().
 * Manages token aggregation and yields normalized cumulative usage.
 *
 * @param {Object} options
 * @param {string} options.model - Model ID
 * @param {number} options.temperature - Sampling temperature
 * @param {number} options.maxOutputTokens - Max tokens for response
 * @returns {Promise<Object>} Handler with sendMessage and destroy
 */
export const createHandler = async ({
  model,
  temperature,
  maxOutputTokens,
}) => {
  const engine = await getLlmEngine(model);

  // Token tracking: web-llm gives per-call usage, we aggregate
  let aggregatePromptTokens = 0;
  let aggregateCompletionTokens = 0;

  return {
    /**
     * Send a message and stream response.
     * Yields normalized cumulative usage for consistent interface.
     * @param {Array<{role: string, content: string}>} messages - Full messages array
     * @yields {{ type: "data" | "finishReason" | "usage", message: any }}
     */
    async *sendMessage(messages) {
      const stream = await engine.chat.completions.create({
        messages,
        temperature,
        max_tokens: maxOutputTokens,
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
        }
      }

      // Yield normalized cumulative usage
      if (usage) {
        const inputTokens = usage.prompt_tokens ?? 0;
        const outputTokens = usage.completion_tokens ?? 0;

        // Aggregate across turns
        aggregatePromptTokens += inputTokens;
        aggregateCompletionTokens += outputTokens;

        yield {
          type: "usage",
          message: {
            // Per-turn tokens
            inputTokens,
            outputTokens,
            // Cumulative tokens (normalized interface)
            totalInputTokens: aggregatePromptTokens,
            totalOutputTokens: aggregateCompletionTokens,
            totalTokens: aggregatePromptTokens + aggregateCompletionTokens,
            // For caller's history update
            assistantContent,
          },
        };
      }
    },

    destroy() {
      // web-llm engines are cached and reused, no cleanup needed per-session
    },
  };
};

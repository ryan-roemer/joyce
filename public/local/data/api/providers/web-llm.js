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
// Unified Provider Interface (matching Chrome provider pattern)
// ============================================================================

/**
 * Create a web-llm session for conversations.
 * Unlike Chrome's stateful sessions, web-llm is stateless - the session holds
 * config and the caller must pass message history to sendMessage().
 *
 * @param {Object} options
 * @param {string} options.model - Model ID
 * @param {number} options.temperature - Sampling temperature
 * @param {number} options.maxOutputTokens - Max tokens for response
 * @returns {Promise<Object>} Session object with engine reference
 */
export const createSession = async ({
  model,
  temperature,
  maxOutputTokens,
}) => {
  const engine = await getLlmEngine(model);
  return {
    engine,
    model,
    temperature,
    maxOutputTokens,
    destroy: () => {
      // web-llm engines are cached and reused, no cleanup needed per-session
    },
  };
};

/**
 * Send a message using a web-llm session.
 * Web-LLM is stateless, so the full messages array (including history) must be passed.
 *
 * @param {Object} session - Session from createSession
 * @param {Array<{role: string, content: string}>} messages - Full message array including history
 * @yields {{ type: "data" | "finishReason" | "usage", message: any }}
 */
export async function* sendMessage(session, messages) {
  const stream = await session.engine.chat.completions.create({
    messages,
    temperature: session.temperature,
    max_tokens: session.maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true },
  });

  let usage = null;

  for await (const chunk of stream) {
    if (chunk.choices[0]?.delta?.content) {
      yield { type: "data", message: chunk.choices[0].delta.content };
    }
    const finishReason = chunk.choices[0]?.finish_reason;
    if (finishReason) {
      yield { type: "finishReason", message: finishReason };
    }
    if (chunk.usage) {
      usage = chunk.usage;
    }
  }

  // Yield usage at the end
  if (usage) {
    yield {
      type: "usage",
      message: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      },
    };
  }
}

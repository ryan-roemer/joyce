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
  supportsMultiTurn: true, // Full messages array each call
  supportsTokenTracking: true, // usage object in response
});

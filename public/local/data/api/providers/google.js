// Google AI provider implementation (stub)
// TODO(GOOGLE): Implement Google AI SDK integration
// See: https://ai.google.dev/gemini-api/docs/get-started/web

/**
 * Set a progress callback for a specific model
 * TODO(GOOGLE): Implement progress callback for local Chrome models
 * @param {string} model - The model ID
 * @param {Function} cb - Progress callback function (unused)
 */
export const setLlmProgressCallback = (/*model,*/ cb) => {
  cb(new Error("Google AI provider not yet implemented. Cannot load model:"));
};

/**
 * Get or create an LLM engine for a specific model
 * @param {string} model - The model ID
 * @returns {Promise<never>} Throws not implemented error
 */
export const getLlmEngine = async (model) => {
  // TODO(GOOGLE): Implement local Chrome model integration
  throw new Error(
    `Google AI provider not yet implemented. Cannot load model: ${model}`,
  );
};

/**
 * Check if a model is cached
 * TODO(GOOGLE): Implement cache check for local Chrome models
 * @param {string} model - The model ID
 * @returns {Promise<boolean>} Always returns false
 */
export const isLlmCached = async (/*model*/) => {
  // TODO(GOOGLE): Check local model cache
  return false;
};

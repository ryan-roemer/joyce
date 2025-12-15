/* global window:false,LanguageModel:false,Writer:false */
// Google AI provider implementation using Chrome Built-in AI APIs
// Supports both Prompt API and Writer API via pseudo-models
// See: https://developer.chrome.com/docs/ai/built-in-apis
//
// ## Enabling in Chrome
// - Prompt: https://developer.chrome.com/docs/ai/prompt-api#use_on_localhost
// - Writer: https://developer.chrome.com/docs/ai/writer-api#add_support_to_localhost
const HAS_PROMPT_API = "LanguageModel" in window;
const HAS_WRITER_API = "Writer" in window;
export const ANY_GOOGLE_API_POSSIBLE = HAS_PROMPT_API || HAS_WRITER_API;

// Map of model -> { progressCallback }
// Note: Unlike web-llm, we don't cache engines because Chrome AI sessions
// maintain internal conversation history. Each chat.completions.create()
// call gets a fresh session to match OpenAI's stateless behavior.
const modelState = new Map();
// TODO: Specify language model output language.

/**
 * Convert Chrome's streaming response to OpenAI-style async iterator.
 * Chrome streams accumulated full text, so we extract deltas.
 * @param {ReadableStream} stream - Chrome AI streaming response (async iterable)
 * @yields {{ choices: [{ delta: { content: string } }] }}
 */
async function* streamToAsyncIterator(stream) {
  let previousText = "";
  for await (const chunk of stream) {
    // Chrome streams full accumulated text, extract the delta
    const delta = chunk.slice(previousText.length);
    previousText = chunk;
    if (delta) {
      yield { choices: [{ delta: { content: delta } }] };
    }
  }
  // Emit final usage stats (Chrome doesn't provide detailed usage, so we estimate)
  // TODO(TOKENS): Wrap up estimation work (1) single estimator, (2) add to stats info vs. real
  const estimatedTokens = Math.ceil(previousText.length / 4);
  yield {
    choices: [{ delta: {} }],
    usage: {
      prompt_tokens: 0, // Chrome doesn't expose this
      completion_tokens: estimatedTokens,
      total_tokens: estimatedTokens,
    },
  };
}

/**
 * Check Chrome AI availability for a specific API type.
 * Uses correct global access and availability values per Chrome documentation.
 * @param {"prompt" | "writer"} apiType - The API to check
 * @returns {Promise<{ available: boolean, downloading?: boolean, reason: string }>}
 */
const checkAvailability = async (apiType) => {
  let status;
  try {
    if (apiType === "prompt") {
      // Feature detection using global LanguageModel
      if (!HAS_PROMPT_API) {
        return {
          available: false,
          reason: "Prompt API not supported in this browser",
        };
      }
      status = await LanguageModel.availability();
    } else if (apiType === "writer") {
      // Feature detection using global Writer
      if (!HAS_WRITER_API) {
        return {
          available: false,
          reason: "Writer API not supported in this browser",
        };
      }
      status = await Writer.availability();
    }
  } catch (err) {
    return { available: false, reason: err.message };
  }

  if (status) {
    // "available" | "downloading" | "downloadable" | "unavailable"
    return {
      available: status === "available",
      downloading: status === "downloading" || status === "downloadable",
      reason: status,
    };
  }

  return { available: false, reason: "Unknown API type" };
};

/**
 * Determine API type from model ID
 * @param {string} model - The model ID (e.g., "gemini-nano-prompt")
 * @returns {"prompt" | "writer"}
 */
const getApiType = (model) => {
  if (model.includes("-writer")) return "writer";
  return "prompt";
};

/**
 * Convert OpenAI-style messages to Chrome AI initialPrompts format.
 * Returns { initialPrompts, lastUserMessage } for session setup.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {{ initialPrompts: Array, lastUserMessage: string }}
 */
const convertMessages = (messages) => {
  // Find the last user message - this will be the prompt
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  if (lastUserIndex === -1) {
    throw new Error("No user message found in messages array");
  }

  const lastUserMessage = messages[lastUserIndex].content;

  // All messages before the last user message become initialPrompts
  const historyMessages = messages.slice(0, lastUserIndex);

  // Convert to Chrome AI format (same role names work)
  const initialPrompts = historyMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return { initialPrompts, lastUserMessage };
};

/**
 * Create a Prompt API engine wrapper with OpenAI-compatible interface.
 * Each chat.completions.create() call creates a fresh session with initialPrompts
 * to match OpenAI's stateless API behavior.
 * @param {Object} options - Engine options
 * @param {Function} options.progressCallback - Optional callback for download progress
 * @returns {Object} Engine with chat.completions.create method
 */
const createPromptEngine = (options = {}) => {
  return {
    chat: {
      completions: {
        create: async ({ messages, stream }) => {
          // TODO(GOOGLE): Add temperature
          // Convert OpenAI messages to Chrome AI format
          const { initialPrompts, lastUserMessage } = convertMessages(messages);

          // Create a fresh session for each request with proper initialPrompts
          // This matches OpenAI's stateless behavior where each call is independent
          const session = await LanguageModel.create({
            initialPrompts:
              initialPrompts.length > 0 ? initialPrompts : undefined,
            monitor(m) {
              m.addEventListener("downloadprogress", (e) => {
                if (options.progressCallback) {
                  options.progressCallback({
                    text: `Downloading model: ${Math.round(e.loaded * 100)}%`,
                    progress: e.loaded,
                  });
                }
              });
            },
          });

          try {
            if (stream) {
              // For streaming, return an async generator that cleans up the session
              const readableStream = session.promptStreaming(lastUserMessage);
              return (async function* () {
                try {
                  yield* streamToAsyncIterator(readableStream);
                } finally {
                  session.destroy();
                }
              })();
            } else {
              const response = await session.prompt(lastUserMessage);
              session.destroy();
              return {
                choices: [{ message: { content: response } }],
              };
            }
          } catch (err) {
            session.destroy();
            throw err;
          }
        },
      },
    },
  };
};

/**
 * Create a Writer API engine wrapper with OpenAI-compatible interface.
 * Writer API is for content generation, not chat - we adapt it by using
 * the last user message as the writing task and other messages as context.
 * @param {Object} options - Writer options
 * @param {Function} options.progressCallback - Optional callback for download progress
 * @returns {Object} Engine with chat.completions.create method
 */
const createWriterEngine = (options = {}) => {
  return {
    chat: {
      completions: {
        create: async ({ messages, stream }) => {
          // For Writer API, the last user message is the writing task
          const userMessages = messages.filter((m) => m.role === "user");
          const writingTask =
            userMessages.length > 0
              ? userMessages[userMessages.length - 1].content
              : "";

          // Build context from system and assistant messages
          const contextMessages = messages.filter((m) => m.role !== "user");
          const sharedContext = contextMessages
            .map((m) => m.content)
            .join("\n\n");

          // Create a fresh writer for each request
          const writer = await Writer.create({
            tone: options.tone || "neutral",
            length: options.length || "medium",
            format: options.format || "markdown",
            sharedContext: sharedContext || undefined,
            expectedInputLanguages: ["en"],
            expectedContextLanguages: ["en"],
            outputLanguage: "en",
            monitor(m) {
              m.addEventListener("downloadprogress", (e) => {
                if (options.progressCallback) {
                  options.progressCallback({
                    text: `Downloading model: ${Math.round(e.loaded * 100)}%`,
                    progress: e.loaded,
                  });
                }
              });
            },
          });

          try {
            if (stream) {
              // For streaming, return an async generator that cleans up the writer
              const readableStream = writer.writeStreaming(writingTask);
              return (async function* () {
                try {
                  yield* streamToAsyncIterator(readableStream);
                } finally {
                  writer.destroy();
                }
              })();
            } else {
              const response = await writer.write(writingTask);
              writer.destroy();
              return {
                choices: [{ message: { content: response } }],
              };
            }
          } catch (err) {
            writer.destroy();
            throw err;
          }
        },
      },
    },
  };
};

/**
 * Set a progress callback for a specific model.
 * Chrome manages downloads internally, so we report availability status.
 * @param {string} model - The model ID
 * @param {Function} cb - Progress callback function
 */
export const setLlmProgressCallback = async (model, cb) => {
  if (!modelState.has(model)) {
    modelState.set(model, { progressCallback: null });
  }
  modelState.get(model).progressCallback = cb;

  // Check availability and report status
  const apiType = getApiType(model);
  const status = await checkAvailability(apiType);

  if (!status.available && !status.downloading) {
    cb(new Error(status.reason || "Chrome AI not available"));
  } else if (status.downloading) {
    cb({ text: "Waiting for Chrome to download AI model..." });
  } else {
    cb({ text: "Chrome AI ready", progress: 1 });
  }
};

/**
 * Get or create an LLM engine for a specific model.
 * @param {string} model - The model ID (e.g., "gemini-nano-prompt", "gemini-nano-writer")
 * @returns {Promise<Object>} Engine with OpenAI-compatible chat.completions.create
 */
export const getLlmEngine = async (model) => {
  const apiType = getApiType(model);

  // Check availability first
  const status = await checkAvailability(apiType);
  if (!status.available && !status.downloading) {
    throw new Error(
      `Chrome AI (${apiType} API) not available: ${status.reason}. ` +
        "Ensure you're using Chrome 138+ with AI features enabled.",
    );
  }

  // Get stored progress callback if any
  const state = modelState.get(model) || { progressCallback: null };
  const options = { progressCallback: state.progressCallback };

  // Return appropriate engine (engines are stateless wrappers, not cached sessions)
  if (apiType === "writer") {
    return createWriterEngine(options);
  } else if (apiType === "prompt") {
    return createPromptEngine(options);
  } else {
    throw new Error(`Unknown API type: ${apiType}`);
  }
};

/**
 * Check if a model is cached/ready.
 * For Chrome AI, this checks if the model is "available" (ready to use).
 * @param {string} model - The model ID
 * @returns {Promise<boolean>} Whether the model is ready
 */
export const isLlmCached = async (model) => {
  const apiType = getApiType(model);
  const status = await checkAvailability(apiType);
  return status.available === true;
};

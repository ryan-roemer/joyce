/* global LanguageModel:false,Writer:false */
// Chrome AI provider implementation using Chrome Built-in AI APIs
// Supports both Prompt API and Writer API via pseudo-models
// See: https://developer.chrome.com/docs/ai/built-in-apis

import {
  CHROME_DEFAULT_TOP_K,
  CHROME_HAS_PROMPT_API,
  CHROME_HAS_WRITER_API,
} from "../../../../config.js";

// Set to true to enable detailed token debugging in console
const DEBUG_TOKENS = false;

const PROMPT_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

const WRITER_OPTIONS = {
  expectedInputLanguages: ["en"],
  expectedContextLanguages: ["en"],
};

// Map of model -> { progressCallback }
// Note: Unlike web-llm, we don't cache engines because Chrome AI sessions
// maintain internal conversation history. Each chat.completions.create()
// call gets a fresh session to match OpenAI's stateless behavior.
const modelState = new Map();
// TODO: Specify language model output language.

/**
 * Convert Chrome's streaming response to OpenAI-style async iterator.
 * Chrome streams accumulated full text, so we extract deltas.
 * @param {Object} options
 * @param {AsyncIterable} options.stream - Chrome AI streaming response
 * @param {number} options.inputTokens - Pre-captured input token count
 * @yields {{ choices: [{ delta: { content: string } }] }}
 */
async function* streamToAsyncIterator({ stream, inputTokens }) {
  let content = "";

  for await (const chunk of stream) {
    if (chunk) {
      yield { choices: [{ delta: { content: chunk } }] };
      content += chunk;
    }
  }

  yield {
    choices: [{ delta: {} }],
    usage: getUsage({ inputTokens, content }),
  };
}

/**
 * Build usage object for Chrome AI responses.
 * @param {Object} options
 * @param {number} options.inputTokens - Pre-captured input token count
 * @param {string} options.content - Generated output content
 * @returns {{ prompt_tokens: number, completion_tokens: number, total_tokens: number }}
 */
const getUsage = ({ inputTokens, content }) => {
  // Estimate output tokens from content length (~4 chars per token)
  const completionTokensEst = Math.ceil((content?.length ?? 0) / 4);

  if (DEBUG_TOKENS) {
    // eslint-disable-next-line no-undef
    console.log(
      "DEBUG(TOKENS) Chrome getUsage:",
      JSON.stringify(
        {
          inputTokens,
          contentLength: content?.length,
          completionTokensEst,
        },
        null,
        2,
      ),
    );
  }

  return {
    prompt_tokens: inputTokens,
    completion_tokens: completionTokensEst,
    total_tokens: inputTokens + completionTokensEst,
  };
};

/**
 * Create a download progress monitor for Chrome AI APIs.
 * @param {Function|null} progressCallback - Optional callback for download progress
 * @returns {Function} Monitor function for Chrome AI create() options
 */
const createDownloadMonitor = (progressCallback) => (m) => {
  m.addEventListener("downloadprogress", (e) => {
    progressCallback?.({
      text: `Downloading model: ${Math.round(e.loaded * 100)}%`,
      progress: e.loaded,
    });
  });
};

/**
 * Check Chrome AI availability for a specific API type.
 * Uses correct global access and availability values per Chrome documentation.
 * @param {"prompt" | "writer"} apiType - The API to check
 * @returns {Promise<{ available: boolean, downloading?: boolean, reason: string }>}
 */
export const checkAvailability = async (apiType) => {
  let status;
  try {
    if (apiType === "prompt") {
      // Feature detection using global LanguageModel
      if (!CHROME_HAS_PROMPT_API) {
        return {
          available: false,
          reason: "Prompt API not supported in this browser",
        };
      }
      status = await LanguageModel.availability(PROMPT_OPTIONS);
    } else if (apiType === "writer") {
      // Feature detection using global Writer
      if (!CHROME_HAS_WRITER_API) {
        return {
          available: false,
          reason: "Writer API not supported in this browser",
        };
      }
      status = await Writer.availability(WRITER_OPTIONS);
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
const createPromptMessages = (messages) => {
  // Find the last user message - this will be the prompt
  // TODO(CHROME): Double check this one...
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
 * to match OpenAI's stateless API behavior. Streaming-only.
 * @param {Object} options - Engine options
 * @param {Function} options.progressCallback - Optional callback for download progress
 * @returns {Object} Engine with chat.completions.create method
 */
const createPromptEngine = (options = {}) => ({
  chat: {
    completions: {
      create: async ({ messages, temperature }) => {
        const { initialPrompts, lastUserMessage } =
          createPromptMessages(messages);

        const session = await LanguageModel.create({
          ...PROMPT_OPTIONS,
          topK: CHROME_DEFAULT_TOP_K,
          temperature,
          initialPrompts:
            initialPrompts.length > 0 ? initialPrompts : undefined,
          monitor: createDownloadMonitor(options.progressCallback),
        }).catch((err) => {
          // console.error("ERROR: PROMPT SESSION CREATE", err);
          throw err;
        });

        // Capture inputUsage BEFORE streaming (it represents tokens from initialPrompts)
        const initialInputUsage = session.inputUsage ?? 0;

        // Measure the prompt message tokens and add to initial usage
        const promptTokens = await session.measureInputUsage(lastUserMessage);
        const inputTokens = initialInputUsage + promptTokens;

        if (DEBUG_TOKENS) {
          // eslint-disable-next-line no-undef
          console.log(
            "DEBUG(TOKENS) Chrome Prompt API - token capture:",
            JSON.stringify(
              {
                initialInputUsage,
                promptTokens,
                inputTokens,
                inputQuota: session.inputQuota,
              },
              null,
              2,
            ),
          );
        }

        const stream = session.promptStreaming(lastUserMessage);
        return (async function* () {
          try {
            yield* streamToAsyncIterator({ stream, inputTokens });
          } finally {
            session.destroy();
          }
        })();
      },
    },
  },
});

/**
 * Convert OpenAI-style messages to Chrome Writer API format.
 * Returns { sharedContext, writingTask, context } for Writer.create() and write().
 * @param {Array<{role: string, content: string}>} messages
 * @returns {{ sharedContext: string, writingTask: string, context: string }}
 */
const createWriterMessages = (messages) => {
  // Last user message becomes the writing task
  const userMessages = messages.filter((m) => m.role === "user");
  const writingTask =
    userMessages.length > 0
      ? userMessages[userMessages.length - 1].content
      : "";

  // Non-user messages (system, assistant) become shared context
  const contextMessages = messages.filter((m) => m.role !== "user");
  const sharedContext = contextMessages.map((m) => m.content).join("\n\n");

  return { sharedContext, writingTask, context: "" };
};

/**
 * Create a Writer API engine wrapper with OpenAI-compatible interface.
 * Writer API is for content generation, not chat - we adapt it by using
 * the last user message as the writing task and other messages as context. Streaming-only.
 * @param {Object} options - Writer options
 * @param {Function} options.progressCallback - Optional callback for download progress
 * @returns {Object} Engine with chat.completions.create method
 */
const createWriterEngine = (options = {}) => ({
  chat: {
    completions: {
      create: async ({ messages }) => {
        const { sharedContext, writingTask, context } =
          createWriterMessages(messages);

        const writer = await Writer.create({
          tone: options.tone || "neutral",
          length: options.length || "medium",
          format: options.format || "markdown",
          sharedContext,
          ...WRITER_OPTIONS,
          outputLanguage: "en",
          monitor: createDownloadMonitor(options.progressCallback),
        });

        // Writer API doesn't have inputUsage property, use measureInputUsage() instead
        // NOTE: This only measures writingTask + context, NOT sharedContext.
        // Chrome's Writer API doesn't expose total input tokens including sharedContext.
        // For full accuracy, we'd need to estimate sharedContext tokens separately.
        const inputTokens = await writer.measureInputUsage(writingTask, {
          context,
        });

        if (DEBUG_TOKENS) {
          // eslint-disable-next-line no-undef
          console.log(
            "DEBUG(TOKENS) Chrome Writer API - token capture:",
            JSON.stringify(
              {
                inputTokens,
                inputQuota: writer.inputQuota,
              },
              null,
              2,
            ),
          );
        }

        const stream = writer.writeStreaming(writingTask, { context });
        return (async function* () {
          try {
            yield* streamToAsyncIterator({ stream, inputTokens });
          } finally {
            writer.destroy();
          }
        })();
      },
    },
  },
});

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

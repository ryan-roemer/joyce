/* global LanguageModel:false,Writer:false */
// Chrome AI provider implementation using Chrome Built-in AI APIs
// Supports both Prompt API and Writer API via pseudo-models
// See: https://developer.chrome.com/docs/ai/built-in-apis

import {
  CHROME_HAS_PROMPT_API,
  CHROME_HAS_WRITER_API,
} from "../../../../shared-config.js";

const MODEL_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

// Map of model -> { progressCallback }
const modelState = new Map();

// Map of conversationId -> { session, model, apiType }
// Stores persistent sessions for multi-turn conversations
const persistentSessions = new Map();

// Token usage threshold - warn when this percentage of quota is used
const TOKEN_WARNING_THRESHOLD = 0.85;

/**
 * Get session token info for capacity tracking.
 * @param {Object} session - Chrome AI session
 * @returns {{ used: number, remaining: number, total: number, nearLimit: boolean }}
 */
const getSessionTokenInfo = (session) => {
  const used = session?.inputUsage ?? 0;
  const total = session?.inputQuota ?? 0;
  const remaining = Math.max(0, total - used);
  const nearLimit = total > 0 && used / total >= TOKEN_WARNING_THRESHOLD;

  return { used, remaining, total, nearLimit };
};

/**
 * Convert Chrome's streaming response to OpenAI-style async iterator.
 * Chrome streams accumulated full text, so we extract deltas.
 * @param {ReadableStream} stream - Chrome AI streaming response (async iterable)
 * @param {Object} session - Chrome AI session for usage tracking
 * @param {boolean} isPersistent - Whether this is a persistent session
 * @yields {{ choices: [{ delta: { content: string } }], usage?, sessionInfo? }}
 */
async function* streamToAsyncIterator({
  stream,
  session,
  isPersistent = false,
}) {
  let content = "";

  for await (const chunk of stream) {
    if (chunk) {
      yield { choices: [{ delta: { content: chunk } }] };
      content += chunk;
    }
  }

  // Get usage and session info
  const usage = getUsage({ session, content });
  const sessionInfo = isPersistent ? getSessionTokenInfo(session) : null;

  yield {
    choices: [{ delta: {} }],
    usage,
    sessionInfo,
  };
}

const getUsage = ({ session, content }) => {
  const completionTokensEst = Math.ceil((content.length ?? 0) / 4);

  return {
    prompt_tokens: session?.inputUsage ?? 0,
    completion_tokens: completionTokensEst,
    total_tokens: (session?.inputUsage ?? 0) + completionTokensEst,
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
      status = await LanguageModel.availability(MODEL_OPTIONS);
    } else if (apiType === "writer") {
      // Feature detection using global Writer
      if (!CHROME_HAS_WRITER_API) {
        return {
          available: false,
          reason: "Writer API not supported in this browser",
        };
      }
      status = await Writer.availability(MODEL_OPTIONS);
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
 * Get or create a persistent session for a conversation.
 * @param {string} conversationId - Unique conversation identifier
 * @param {string} model - The model ID
 * @param {Array} initialPrompts - Initial prompts for new session
 * @param {Function} progressCallback - Optional progress callback
 * @returns {Promise<Object>} The session object
 */
const getOrCreatePersistentSession = async (
  conversationId,
  model,
  initialPrompts,
  progressCallback,
) => {
  // Check if we have an existing session for this conversation
  if (persistentSessions.has(conversationId)) {
    const cached = persistentSessions.get(conversationId);
    // Verify it's the same model
    if (cached.model === model && cached.session) {
      return cached.session;
    }
    // Different model - destroy old session
    try {
      cached.session?.destroy();
    } catch (e) {
      // Ignore destroy errors
    }
    persistentSessions.delete(conversationId);
  }

  // Create new session
  const session = await LanguageModel.create({
    ...MODEL_OPTIONS,
    initialPrompts: initialPrompts.length > 0 ? initialPrompts : undefined,
    monitor: createDownloadMonitor(progressCallback),
  });

  // Store for reuse
  persistentSessions.set(conversationId, {
    session,
    model,
    apiType: "prompt",
  });

  return session;
};

/**
 * Destroy a persistent session for a conversation.
 * Call this when starting a new conversation.
 * @param {string} conversationId - The conversation ID to clean up
 */
export const destroyPersistentSession = (conversationId) => {
  if (persistentSessions.has(conversationId)) {
    const cached = persistentSessions.get(conversationId);
    try {
      cached.session?.destroy();
    } catch (e) {
      // Ignore destroy errors
    }
    persistentSessions.delete(conversationId);
  }
};

/**
 * Check if a conversation has remaining token capacity.
 * @param {string} conversationId - The conversation ID
 * @returns {{ hasCapacity: boolean, tokenInfo: Object | null }}
 */
export const checkSessionCapacity = (conversationId) => {
  if (!persistentSessions.has(conversationId)) {
    return { hasCapacity: true, tokenInfo: null };
  }

  const { session } = persistentSessions.get(conversationId);
  const tokenInfo = getSessionTokenInfo(session);

  return {
    hasCapacity: tokenInfo.remaining > 100, // Need at least 100 tokens for a response
    tokenInfo,
  };
};

/**
 * Create a Prompt API engine wrapper with OpenAI-compatible interface.
 * Supports both stateless (fresh session per call) and persistent (reused session) modes.
 * @param {Object} options - Engine options
 * @param {Function} options.progressCallback - Optional callback for download progress
 * @param {string} options.model - The model ID (for persistent sessions)
 * @returns {Object} Engine with chat.completions.create method
 */
const createPromptEngine = (options = {}) => ({
  chat: {
    completions: {
      /**
       * Create a chat completion.
       * @param {Object} params
       * @param {Array} params.messages - Messages array
       * @param {string} params.conversationId - Optional conversation ID for session reuse
       * @param {boolean} params.isNewConversation - If true, destroys existing session first
       */
      create: async ({ messages, conversationId, isNewConversation }) => {
        const { initialPrompts, lastUserMessage } =
          createPromptMessages(messages);

        let session;
        let isPersistent = false;

        if (conversationId) {
          // Persistent session mode
          isPersistent = true;

          // If starting new conversation, destroy old session first
          if (isNewConversation) {
            destroyPersistentSession(conversationId);
          }

          // Check if we have an existing session (continuing conversation)
          const hasExisting = persistentSessions.has(conversationId);

          if (hasExisting) {
            // Reuse existing session - just prompt with the new user message
            // (initialPrompts are already in the session's context)
            session = persistentSessions.get(conversationId).session;
          } else {
            // First turn - create session with initialPrompts
            session = await getOrCreatePersistentSession(
              conversationId,
              options.model,
              initialPrompts,
              options.progressCallback,
            );
          }
        } else {
          // Stateless mode - create fresh session each time
          session = await LanguageModel.create({
            ...MODEL_OPTIONS,
            initialPrompts:
              initialPrompts.length > 0 ? initialPrompts : undefined,
            monitor: createDownloadMonitor(options.progressCallback),
          }).catch((err) => {
            throw err;
          });
        }

        const stream = session.promptStreaming(lastUserMessage);

        return (async function* () {
          try {
            yield* streamToAsyncIterator({ stream, session, isPersistent });
          } finally {
            // Only destroy if not persistent
            if (!isPersistent) {
              session.destroy();
            }
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
          ...MODEL_OPTIONS,
          outputLanguage: "en",
          monitor: createDownloadMonitor(options.progressCallback),
        });

        const stream = writer.writeStreaming(writingTask, { context });
        // console.log("TODO: WRITER STREAM", { writer, stream });
        return (async function* () {
          try {
            yield* streamToAsyncIterator({ stream });
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
  const options = { progressCallback: state.progressCallback, model };

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

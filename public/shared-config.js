/**
 * Shared client configuration. (No secrets).
 */
const BASE_PAGES = [
  { name: "Home", naveName: "Joyce", to: "/", icon: "iconoir-post" },
  { name: "Posts", to: "/posts", icon: "iconoir-multiple-pages-empty" },
  { name: "Search", to: "/search", icon: "iconoir-doc-magnifying-glass-in" },
  {
    name: "Chat",
    to: "/chat",
    icon: "iconoir-chat-bubble",
  },
  { name: "Settings", to: "/settings", icon: "iconoir-tools" },
];

const DEV_ONLY_PAGES = [{ name: "Data", to: "/data", icon: "iconoir-cpu" }];

export const TOKEN_CUSHION_CHAT = 512; // 250 ok for web-llm
export const TOKEN_CUSHION_EMBEDDINGS = 25;

// TODO(CHAT): Can we programmatically get these values?
export const GEMMA_NANO_MAX_TOKENS = 32768;
export const GEMMA_NANO_MAX_TOKENS_ADJUSTED = 8192; // Session max input is much smaller, like around 9K on my mac.

/**
 * Get the path to the embeddings file for a given chunk size.
 * @param {number} size - The chunk size (e.g., 256, 512)
 * @returns {string} - The path to the embeddings file
 */
export const getEmbeddingsPath = (size = DEFAULT_EMBEDDING_CHUNK_SIZE) =>
  `/data/posts-embeddings-${size}.json`;

const config = {
  pages: {
    all: [...BASE_PAGES, ...DEV_ONLY_PAGES],
    simple: BASE_PAGES,
  },
  embeddings: {
    // Note: if you change the embedding model, you'll need to re-generate all post embeddings.
    model: "Xenova/gte-small",
    maxTokens: 512, // https://huggingface.co/thenlper/gte-small#limitation
    dataChunkSizes: {
      MEDIUM: 256,
      LARGE: 512,
    },
  },
  // web-llm model metadata (vramMb, maxTokens) is mutated into model objects at load time
  // from prebuiltAppConfig. See: https://github.com/mlc-ai/web-llm/blob/main/src/config.ts
  webLlm: {
    models: {
      chat: [
        // {
        //   // TODO: REMOVE?
        //   // Notes: prone to ongoing gibberish.
        //   model: "SmolLM2-360M-Instruct-q4f16_1-MLC",
        //   modelShortName: "SmolLM2-360M",
        //   autoLoad: false,
        // },
        {
          model: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
          modelShortName: "TinyLlama-1.1B",
          shortOption: "Fast",
          default: true,
        },
        {
          model: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
          modelShortName: "SmolLM2-1.7B",
          shortOption: "Better",
        },
        {
          model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
          modelShortName: "Llama-3.2-1B",
          shortOption: "Best",
        },
      ],
    },
  },
  // Chrome Built-in AI (Gemini Nano) - available in Chrome with AI features enabled
  // See: https://developer.chrome.com/docs/ai/built-in-apis
  chrome: {
    models: {
      chat: [
        {
          model: "gemini-nano-prompt",
          modelShortName: "Gemini Nano (Prompt)",
          shortOption: "Flexible",
          api: "prompt",
          maxTokens: GEMMA_NANO_MAX_TOKENS_ADJUSTED,
        },
        {
          model: "gemini-nano-writer",
          modelShortName: "Gemini Nano (Writer)",
          shortOption: "Writing",
          api: "writer",
          maxTokens: GEMMA_NANO_MAX_TOKENS_ADJUSTED,
        },
      ],
    },
  },
};

// Default embedding chunk size (uses the MEDIUM size from dataChunkSizes)
export const DEFAULT_EMBEDDING_CHUNK_SIZE =
  config.embeddings.dataChunkSizes.MEDIUM;

export const ALL_PROVIDERS = {
  webLlm: "web-llm",
  chrome: "Chrome",
};

export const ALL_CHAT_MODELS = Object.keys(ALL_PROVIDERS).map((provider) => ({
  provider,
  models: config[provider].models.chat,
}));

export const CHAT_MODELS_MAP = Object.fromEntries(
  ALL_CHAT_MODELS.map(({ provider, models }) => [
    provider,
    Object.fromEntries(models.map((modelObj) => [modelObj.model, modelObj])),
  ]),
);

// Find the default chat model by looking for `default: true` across all providers
export const DEFAULT_CHAT_MODEL = (() => {
  for (const { provider, models } of ALL_CHAT_MODELS) {
    const defaultModel = models.find((m) => m.default);
    if (defaultModel) {
      return { provider, model: defaultModel.model };
    }
  }
  throw new Error(
    "No default chat model found (set `default: true` on a model)",
  );
})();
export const DEFAULT_DATASTORE = "postgresql";
export const DEFAULT_API = "chat";
export const DEFAULT_TEMPERATURE = 1;

export const getModelCfg = ({ provider, model }) => {
  const modelCfg = CHAT_MODELS_MAP[provider][model];
  if (!modelCfg) {
    throw new Error(
      `Could not find config options for model "${model}". Incorrect configuration?`,
    );
  }
  return modelCfg;
};

export const getSimpleModelOptions = (provider) =>
  config[provider].models.chat
    .filter((m) => m.shortOption)
    .map(({ model, shortOption }) => ({ provider, model, label: shortOption }));

/**
 * Find which provider owns a given model ID.
 * @param {string} modelId - The model ID to look up
 * @returns {string | null} The provider key or null if not found
 */
export const getProviderForModel = (modelId) => {
  for (const { provider, models } of ALL_CHAT_MODELS) {
    if (models.some((m) => m.model === modelId)) {
      return provider;
    }
  }
  return null;
};

export default config;

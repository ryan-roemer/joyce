import { prebuiltAppConfig } from "@mlc-ai/web-llm";

// https://github.com/mlc-ai/web-llm/blob/main/src/config.ts
// Quantization formats: q{bits}f{float_bits}[_{version}]
// e.g., q4f16_1 = 4-bit quantization with float16, q0f32 = full precision float32
const QUANTIZATION_REGEX = /q\d+f\d+(?:_\d+)?/;

export const MODELS = prebuiltAppConfig.model_list
  .map((model) => ({
    model: model.model_id,
    modelUrl: model.model,
    quantization: model.model_id.match(QUANTIZATION_REGEX)?.[0] ?? null,
    maxTokens: model.overrides?.context_window_size ?? null,
    vramMb: model.vram_required_MB ?? null,
  }))
  .sort((a, b) => (a.vramMb ?? 0) - (b.vramMb ?? 0));

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

export const TOKEN_CUSHION_CHAT = 200;
export const TOKEN_CUSHION_EMBEDDINGS = 25;

const config = {
  pages: {
    all: [...BASE_PAGES, ...DEV_ONLY_PAGES],
    simple: BASE_PAGES,
  },
  embeddings: {
    // Note: if you change the embedding model, you'll need to re-generate all post embeddings.
    model: "Xenova/gte-small",
    maxTokens: 512, // https://huggingface.co/thenlper/gte-small#limitation
  },
  // web-llm model metadata (vramMb, maxTokens) is mutated into model objects at load time
  // from prebuiltAppConfig. See: https://github.com/mlc-ai/web-llm/blob/main/src/config.ts
  webLlm: {
    models: {
      chat: [
        {
          // TODO: REMOVE?
          // Notes: prone to ongoing gibberish.
          model: "SmolLM2-360M-Instruct-q4f16_1-MLC",
          modelShortName: "SmolLM2-360M",
          autoLoad: false,
        },
        {
          model: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
          modelShortName: "TinyLlama-1.1B",
          shortOption: "Fast",
          default: true,
          autoLoad: true,
        },
        {
          model: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
          modelShortName: "SmolLM2-1.7B",
          shortOption: "Better",
          autoLoad: false,
        },
        {
          model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
          modelShortName: "Llama-3.2-1B",
          shortOption: "Best",
          autoLoad: false,
        },
        {
          model: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
          modelShortName: "Llama-3.2-3B",
          autoLoad: false,
        },
        {
          model: "Qwen3-4B-q4f16_1-MLC",
          modelShortName: "Qwen3-4B",
          autoLoad: false,
        },
      ],
    },
  },
};

export const ALL_PROVIDERS = {
  webLlm: "web-llm",
};

export const ALL_CHAT_MODELS = Object.keys(ALL_PROVIDERS).map((provider) => ({
  provider,
  models: config[provider].models.chat,
}));

const CHAT_MODELS_MAP = Object.fromEntries(
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

// Mutate web-llm models to include metadata from prebuiltAppConfig
for (const modelObj of config.webLlm.models.chat) {
  const found = prebuiltAppConfig.model_list.find(
    (m) => m.model_id === modelObj.model,
  );
  if (found) {
    modelObj.maxTokens = found.overrides?.context_window_size ?? null;
    modelObj.vramMb = found.vram_required_MB ?? null;
    modelObj.quantization =
      found.model_id.match(QUANTIZATION_REGEX)?.[0] ?? null;
  }
}

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
 * Dynamically add a model to the chat models list (session only, not persisted).
 * Used when loading unconfigured models from the models table.
 * @param {string} modelId - The model ID to add
 * @returns {Object} The model config object (existing or newly created)
 */
export const addChatModel = (modelId) => {
  // Check if already exists
  const existing = config.webLlm.models.chat.find((m) => m.model === modelId);
  if (existing) return existing;

  // Look up metadata from prebuiltAppConfig
  const prebuilt = prebuiltAppConfig.model_list.find(
    (m) => m.model_id === modelId,
  );

  // Create new model config
  const newModel = {
    model: modelId,
    modelShortName: modelId.split("-q")[0], // Strip quantization suffix for short name
    autoLoad: false,
    maxTokens: prebuilt?.overrides?.context_window_size ?? null,
    vramMb: prebuilt?.vram_required_MB ?? null,
    quantization: modelId.match(QUANTIZATION_REGEX)?.[0] ?? null,
  };

  // Add to config array (ALL_CHAT_MODELS references this, so it auto-updates)
  config.webLlm.models.chat.push(newModel);

  // Update CHAT_MODELS_MAP
  if (!CHAT_MODELS_MAP.webLlm) {
    CHAT_MODELS_MAP.webLlm = {};
  }
  CHAT_MODELS_MAP.webLlm[modelId] = newModel;

  return newModel;
};

export default config;

import { prebuiltAppConfig } from "@mlc-ai/web-llm";

const MODELS = prebuiltAppConfig.model_list
  .filter((model) => model.model_id.includes("-q4f16_1-"))
  .map((model) => ({
    model: model.model_id,
    maxTokens: model.overrides?.context_window_size ?? null,
    vramMb: model.vram_required_MB ?? null,
  }))
  .sort((a, b) => a.vramMb - b.vramMb);

console.log("TODO (I) MODELS: ", MODELS); // eslint-disable-line no-undef

/**
 * Shared client configuration. (No secrets).
 */
const ALL_PAGES = [
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

export const TOKEN_CUSHION_CHAT = 200;
export const TOKEN_CUSHION_EMBEDDINGS = 25;

const config = {
  pages: {
    all: ALL_PAGES,
    // Note: presently all pages are simple. Keep for future use if need dev-only pages.
    simple: ALL_PAGES,
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
      chatDefault: "SmolLM2-360M-Instruct-q4f16_1-MLC",
      chat: [
        {
          model: "SmolLM2-360M-Instruct-q4f16_1-MLC",
          modelShortName: "SmolLM2-360M",
          shortOption: "Fastest",
          autoLoad: true, // Default model, auto-loaded on app start
        },
        {
          model: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
          modelShortName: "TinyLlama-1.1B",
          shortOption: "Best",
          autoLoad: false, // Manual load only
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

export const CHAT_MODELS_MAP = Object.fromEntries(
  ALL_CHAT_MODELS.map(({ provider, models }) => [
    provider,
    Object.fromEntries(models.map((modelObj) => [modelObj.model, modelObj])),
  ]),
);

export const DEFAULT_CHAT_MODEL = {
  provider: "webLlm",
  model: "SmolLM2-360M-Instruct-q4f16_1-MLC",
};
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
  }
}

export const getModelCfg = ({ provider, model }) => {
  const modelCfg = config[provider].models.chat.find(
    (opt) => opt.model === model,
  );
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

console.log("TODO (I) config: ", config); // eslint-disable-line no-undef

export default config;

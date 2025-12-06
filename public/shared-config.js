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
    redirects: ["/openai/chat", "/openai/rag"],
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
};

export const ALL_PROVIDERS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
};

export const ALL_CHAT_MODELS = Object.keys(ALL_PROVIDERS).map((provider) => ({
  provider,
  models: [], // TODO(CHAT): Add models.
}));

export const CHAT_MODELS_MAP = Object.fromEntries(
  ALL_CHAT_MODELS.map(({ provider, models }) => [
    provider,
    Object.fromEntries(models.map((modelObj) => [modelObj.model, modelObj])),
  ]),
);

export const DEFAULT_CHAT_MODEL = { provider: "openai", model: "gpt-4.1-nano" };
export const DEFAULT_DATASTORE = "postgresql";
export const DEFAULT_API = "chat";
export const DEFAULT_TEMPERATURE = 1;

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

export default config;

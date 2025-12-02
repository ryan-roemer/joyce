/**
 * Shared client configuration. (No secrets).
 */
const ALL_PAGES = [
  { name: "Blogs", to: "/", icon: "iconoir-post" },
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

export const TOKEN_CUSHION_CHAT = 10000;

const config = {
  pages: {
    all: ALL_PAGES,
    // Note: presently all pages are simple. Keep for future use if need dev-only pages.
    simple: ALL_PAGES,
  },
  openai: {
    models: {
      chatDefault: "gpt-4.1-nano",

      // ## Model basic info.
      // https://platform.openai.com/docs/models
      //
      // ## Model pricing.
      // * Generally available at: https://www.llm-prices.com/current-v1.json
      // * OpenAI: https://platform.openai.com/docs/pricing
      //
      // All values are in USD per 1M tokens in the config objects.
      chat: [
        {
          model: "gpt-4o",
          maxTokens: 128000,
          pricing: { input: 2.5, output: 10.0 },
        },
        {
          model: "gpt-4o-mini",
          maxTokens: 128000,
          pricing: { input: 0.15, output: 0.6 },
        },
        {
          model: "gpt-4.1",
          maxTokens: 1047576,
          pricing: { input: 2.0, output: 8.0 },
        },
        {
          model: "gpt-4.1-mini",
          maxTokens: 1047576,
          pricing: { input: 0.4, output: 1.6 },
        },
        {
          model: "gpt-4.1-nano",
          maxTokens: 1047576,
          pricing: { input: 0.1, output: 0.4 },
        },
        {
          model: "gpt-5.1",
          maxTokens: 400000,
          pricing: { input: 1.25, output: 10.0 },
        },
        {
          model: "gpt-5-mini",
          maxTokens: 400000,
          pricing: { input: 0.25, output: 2.0 },
        },
        {
          model: "gpt-5-nano",
          maxTokens: 400000,
          pricing: { input: 0.05, output: 0.4 },
        },
        {
          model: "o1",
          maxTokens: 200000,
          pricing: { input: 15.0, output: 60.0 },
        },
        // TODO(responses): "The requested model 'o1-mini' is not supported with the Responses API."
        // {
        //   model: "o1-mini",
        //   maxTokens: 128000,
        //   pricing: { input: 1.1, output: 4.4 },
        // },
        {
          model: "o3-mini",
          maxTokens: 200000,
          pricing: { input: 1.1, output: 4.4 },
        },
        {
          model: "o4-mini",
          maxTokens: 200000,
          pricing: { input: 1.1, output: 4.4 },
        },
      ],
    },
  },
  anthropic: {
    models: {
      chat: [
        {
          model: "claude-opus-4-1",
          maxTokens: 200000,
          pricing: { input: 15.0, output: 75.0 },
        },
        {
          model: "claude-opus-4-0",
          maxTokens: 200000,
          pricing: { input: 15.0, output: 75.0 },
        },
        {
          model: "claude-sonnet-4-0",
          maxTokens: 200000,
          pricing: { input: 3.0, output: 15.0 },
        },
        {
          model: "claude-3-7-sonnet-latest",
          maxTokens: 200000,
          pricing: { input: 3.0, output: 15.0 },
        },
        {
          model: "claude-3-5-haiku-latest",
          maxTokens: 200000,
          pricing: { input: 0.8, output: 4.0 },
        },
      ],
    },
  },
  groq: {
    // https://console.groq.com/docs/models
    models: {
      chat: [
        {
          model: "openai/gpt-oss-120b",
          maxTokens: 131072,
          pricing: { input: 0.15, output: 0.6 },
        },
        {
          model: "openai/gpt-oss-20b",
          maxTokens: 131072,
          pricing: { input: 0.075, output: 0.3 },
        },
        {
          model: "llama-3.1-8b-instant",
          maxTokens: 131072,
          pricing: { input: 0.05, output: 0.08 },
        },
        {
          model: "llama-3.3-70b-versatile",
          maxTokens: 131072,
          pricing: { input: 0.59, output: 0.79 },
        },
        {
          model: "meta-llama/llama-4-maverick-17b-128e-instruct",
          maxTokens: 131072,
          pricing: { input: 0.2, output: 0.6 },
        },
        {
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          maxTokens: 131072,
          pricing: { input: 0.11, output: 0.34 },
        },
        {
          model: "moonshotai/kimi-k2-instruct-0905",
          maxTokens: 262144,
          pricing: { input: 1.0, output: 3.0 },
        },
        {
          model: "qwen/qwen3-32b",
          maxTokens: 131072,
          pricing: { input: 0.29, output: 0.59 },
        },
      ],
    },
  },
};

export const ALL_PROVIDERS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
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

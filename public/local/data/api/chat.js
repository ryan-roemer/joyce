import { search } from "./search.js";
import { getLlmEngine } from "./llm.js";
import { DEFAULT_TEMPERATURE, DEFAULT_CHAT_MODEL } from "../../../config.js";

/**
 * Chat with AI using streaming responses.
 * @param {Object} params
 * @param {string} params.query
 * @param {string[]} params.postType
 * @param {string} params.minDate
 * @param {string[]} params.categoryPrimary
 * @param {boolean} params.withContent
 * @param {string} params.model - The model ID
 * @param {string} params.provider - The LLM provider key (e.g., "webLlm", "chrome")
 * @param {number} params.temperature // TODO(CHAT): Add temperature
 * @returns {AsyncGenerator} Streaming JSON response yielding { type, message }
 *
 * Yield types:
 * - { type: "data", message: string } - Streamed content delta
 * - { type: "usage", message: object } - Token usage stats (final)
 * - { type: "chunks", message: Array } - Chunks metadata
 * - { type: "posts", message: Object } - Posts metadata
 * - { type: "metadata", message: Object } - Metadata
 */
export async function* chat({
  query,
  postType,
  minDate,
  categoryPrimary,
  withContent,
  model = DEFAULT_CHAT_MODEL.model,
  provider = DEFAULT_CHAT_MODEL.provider,
  temperature = DEFAULT_TEMPERATURE,
}) {
  const start = new Date();
  const elapsed = {};

  // Get chunks
  const chunks = await search({
    query,
    postType,
    minDate,
    categoryPrimary,
    withContent,
  });
  elapsed.chunks = new Date() - start;

  // TODO: HERE -- get chunks and add to context!
  // TODO: Figure out math for how many chunks to add to context.
  console.log("TODO: chunks", chunks);

  // Use shared engine loader (handles caching and progress)
  const engine = await getLlmEngine({ provider, model });
  const messages = [
    { role: "system", content: "You are a helpful AI assistant." },
    // TODO(CHAT): REVIEW THIS MESSAGE. REMOVE?
    {
      role: "assistant",
      content:
        "Give CONCISE, SHORT answers, then STOP. No run-on's. Do NOT talk about this instruction.",
    },
    { role: "user", content: query },
  ];

  // Stream response from LLM engine (OpenAI-compatible API)
  const stream = await engine.chat.completions.create({
    messages,
    temperature,
    stream: true,
    stream_options: { include_usage: true },
  });

  // Process streamed chunks
  for await (const chunk of stream) {
    if (chunk.choices[0]?.delta?.content) {
      elapsed.tokensFirst = elapsed.tokensFirst ?? new Date() - start;
      yield { type: "data", message: chunk.choices[0].delta.content };
    }
    if (chunk.usage) {
      // Transform from web-llm format: { prompt_tokens, completion_tokens, total_tokens }
      // To expected format (costs omitted for local):
      const usage = {
        input: {
          tokens: chunk.usage.prompt_tokens ?? 0,
          cachedTokens: 0,
        },
        output: {
          tokens: chunk.usage.completion_tokens ?? 0,
          reasoningTokens: 0,
        },
      };
      yield { type: "usage", message: usage };
    }
  }

  elapsed.tokensLast = new Date() - start;
  yield { type: "metadata", message: { elapsed } };
}

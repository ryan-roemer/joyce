import { getLlmEngine } from "./llm.js";
import config from "../../../shared-config.js";
import { DEFAULT_TEMPERATURE } from "../../../shared-config.js";

/**
 * Chat with AI using streaming responses.
 * @param {Object} params
 * @param {string} params.query
 * @param {string} params.model
 * @param {number} params.temperature
 * @returns {AsyncGenerator} Streaming JSON response yielding { type, message }
 *
 * Yield types:
 * - { type: "data", message: string } - Streamed content delta
 * - { type: "usage", message: object } - Token usage stats (final)
 *
 * TODO(RAG): Integrate with search() to get relevant chunks
 * TODO(RAG): Build context from chunks using post content
 * TODO(RAG): Yield { type: "chunks" }, { type: "posts" }, { type: "metadata" }
 */
export async function* chat({
  query,
  model = config.webLlm.models.chatDefault,
  temperature = DEFAULT_TEMPERATURE,
}) {
  const start = new Date();
  const elapsed = {};

  // TODO(CHAT): Add search
  // TODO(CHAT): Add context from chunks
  // TODO(CHAT): Add elapsed for chunks.

  // Use shared engine loader (handles caching and progress)
  const engine = await getLlmEngine(model);

  const messages = [
    { role: "system", content: "You are a helpful AI assistant." },
    { role: "user", content: query },
  ];

  // Stream response from web-llm
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

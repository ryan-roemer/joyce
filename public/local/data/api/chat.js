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
      yield { type: "data", message: chunk.choices[0].delta.content };
    }
    if (chunk.usage) {
      yield { type: "usage", message: chunk.usage };
    }
  }
}

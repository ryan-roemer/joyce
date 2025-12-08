import { getLlmEngine } from "./llm.js";
import config from "../../../shared-config.js";

/**
 * Chat with AI using streaming responses.
 * @param {Object} params
 * @param {string} params.api - Either "chat" or "responses" // TODO(LOCAL): REMOVE OR IMPLEMENT
 * @param {string} params.query
 * @param {string[]} params.postType
 * @param {string} params.minDate
 * @param {string[]} params.categoryPrimary
 * @param {boolean} params.withContent
 * @param {string} params.model
 * @param {string} params.provider // TODO(LOCAL): REMOVE OR IMPLEMENT
 * @param {number} params.temperature // TODO(LOCAL): REMOVE OR IMPLEMENT
 * @param {string} params.datastore // TODO(LOCAL): REMOVE
 * @returns {AsyncGenerator} Streaming JSON response
 */
// TODO(LOCAL): IMPLEMENT!!!
export async function* chat({
  query,
  model = config.webLlm.models.chatDefault,
}) {
  // Use shared engine loader (handles caching and progress)
  const engine = await getLlmEngine(model);

  const messages = [
    { role: "system", content: "You are a helpful AI assistant." },
    { role: "user", content: query },
  ];

  const reply = await engine.chat.completions.create({
    messages,
  });

  yield {
    type: "data",
    message: reply.choices[0].message.content,
  };

  yield {
    type: "usage",
    message: reply.usage,
  };
}

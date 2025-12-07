import { CreateMLCEngine } from "@mlc-ai/web-llm";

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
export async function* chat({ query }) {
  // Callback function to update model loading progress
  const initProgressCallback = (initProgress) => {
    console.log(initProgress);
  };

  // Supported models: https://github.com/mlc-ai/web-llm/blob/main/src/config.ts#L293
  // TODO: LOAD MODELS FROM CONFIG! Note VRAM, etc.
  // const selectedModel = "Llama-3.1-8B-Instruct-q4f32_1-MLC";
  const selectedModel = "SmolLM2-360M-Instruct-q4f16_1-MLC";

  const engine = await CreateMLCEngine(
    selectedModel,
    { initProgressCallback: initProgressCallback }, // engineConfig
  );
  console.log("(I) STARTED query: ", query);

  const messages = [
    { role: "system", content: "You are a helpful AI assistant." },
    { role: "user", content: query },
  ];

  console.log("(I) messages: ", messages);

  const reply = await engine.chat.completions.create({
    messages,
  });
  console.log(reply.choices[0].message);
  console.log(reply.usage);

  yield {
    type: "data",
    message: reply.choices[0].message.content,
  };
}

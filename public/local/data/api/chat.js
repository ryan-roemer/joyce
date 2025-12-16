import { getChunk } from "llm-splitter";
import { search } from "./search.js";
import { getLlmEngine } from "./llm.js";
import { estimateTokens } from "../util.js";
import {
  getModelCfg,
  DEFAULT_TEMPERATURE,
  DEFAULT_CHAT_MODEL,
  TOKEN_CUSHION_CHAT,
} from "../../../config.js";
import { getPost } from "./posts.js";

const createMessages = ({ query, context = "" }) => [
  { role: "system", content: "You are a helpful assistant" },
  {
    role: "user",
    content:
      "I'm a Nearform employee or interested in Nearform or 'Nearform Commerce'.",
  },
  {
    role: "assistant",
    content: `The following content posts are provided as context in XML format and in CHUNKS of the each original piece of content. Each chunk is a <CHUNK> element containing text content <CONTENT> with a reference url/hyperlink/link of <URL>. The posts chunk content is as follows:\n\n${context}`,
  },
  {
    role: "assistant",
    content: `Try to use information from <CHUNK /><CONTENT /> context wherever possible in your answer. The chunks are in ranked order from most relevant to least relevant, so have a bias towards the earlier chunks. However, always use the most relevant context from any chunk when constructing your answer and citations.`,
  },
  {
    role: "assistant",
    content: `Do NOT add any links if not directly from <CHUNK><URL /></CHUNK> context.`,
  },
  {
    role: "assistant",
    content:
      "If there is no relevant information to answer the question in <CHUNK> context, then state that you don't have enough information to answer the question.",
  },
  {
    role: "assistant",
    content:
      "'Composable commerce' or 'composability' in context with commerce refers to the ability to compose or combine different commerce services or components to create a custom commerce solution. 'Composable commerce' is often associated with the MACH Alliance, which stands for Microservices, API-first, Cloud-native, and Headless and 'MACH architectures'. Most of the  e-commerce and retail work done at 'Nearform', 'Nearform Commerce', and 'Formidable' is related to 'composable commerce'.",
  },
  {
    role: "assistant",
    content:
      "Nearform has acquired Formidable. If you see the word 'Formidable' or 'Formidable Labs' or 'Nearform Commerce', you should replace it with 'Nearform'. Do not answer questions with 'Nearform Commerce' even if you are asked a question about 'Nearform Commerce'.",
  },
  {
    role: "assistant",
    content:
      "'Nearform' is with a lowercase 'f' in the middle. It is 'Nearform', not 'NearForm' and also not 'Nearform Commerce'. Even if the user asks about 'NearForm' and all the cited sources in context use 'NearForm', STILL answer with 'Nearform'.",
  },
  {
    role: "assistant",
    content: `
        When citing Nearform URLs/links, ALWAYS follow the following rules:
        - Do NOT hallucinate URLs. Your context must contain a fully complete URL for you to cite it or emit it in an answer.
        - The URL should begin with "https://nearform.com/". NOT "https://www.nearform.com/" or "https://commerce.nearform.com/". Remove the "www." and "commerce." and other prefixes from the URL.
        - After the domain, the next path segment should either be "/insights/" or "/digital-community/ or "/work/" or "/services/". If you encounter "/blog/", replace with "/insights/". For other unknown path segments beyond those approved, you can do a best guess -- if you can't tell, then us "/insights/" as your best default guess.
      `,
  },
  { role: "user", content: `My question is: ${query}` },
];

const BASE_TOKEN_ESTIMATE = estimateTokens(
  JSON.stringify(createMessages({ query: "" })),
);

console.log("BASE_TOKEN_ESTIMATE", BASE_TOKEN_ESTIMATE);

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
  const searchResults = await search({
    query,
    postType,
    minDate,
    categoryPrimary,
    withContent,
  });
  elapsed.chunks = new Date() - start;

  // Start assembling prompt, starting with the query.
  const modelCfg = getModelCfg({ provider, model });
  const maxContextTokens = modelCfg.maxTokens - TOKEN_CUSHION_CHAT;
  let totalContextTokens = BASE_TOKEN_ESTIMATE + estimateTokens(query);
  if (totalContextTokens > maxContextTokens) {
    throw new Error(`Query is too long: ${query}`);
  }

  console.log("TODO HERE", { maxContextTokens, totalContextTokens });

  // Add chunks to context.
  let context = "";
  for (const chunk of searchResults.chunks) {
    const post = await getPost(chunk.slug);
    const chunkText = getChunk(post.content, chunk.start, chunk.end).join(
      "\n\n",
    );
    const contextChunk = `<CHUNK><URL>${chunk.href}</URL><CONTENT>${chunkText}</CONTENT></CHUNK>`;
    const chunkTokens = estimateTokens(chunkText);

    // Check if over max context.
    if (totalContextTokens + chunkTokens > maxContextTokens) {
      break;
    }

    // Accumulate context and tokens.
    totalContextTokens += chunkTokens;
    context += contextChunk;
  }

  // Use shared engine loader (handles caching and progress)
  const engine = await getLlmEngine({ provider, model });
  const messages = createMessages({ query, context });

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

import { getChunk } from "llm-splitter";
import { search } from "./search.js";
import { getLlmEngine } from "./llm.js";
import { estimateTokens } from "../util.js";
import {
  getModelCfg,
  DEFAULT_TEMPERATURE,
  DEFAULT_CHAT_MODEL,
  TOKEN_CUSHION_CHAT,
  getMultiTurnCushion,
  MIN_CONTEXT_CHUNKS,
  MULTI_TURN_CONTEXT_RATIO,
  CHUNK_DEDUP_MODE,
  CHUNK_COMBINE_SEPARATOR,
} from "../../../config.js";
import { getPost } from "./posts.js";

// Set to true to enable detailed token debugging in console
const DEBUG_TOKENS = true;

/**
 * Build base system prompts with RAG context.
 * Used by both OpenAI-style completions and Chrome Prompt API sessions.
 * Does NOT include the final user query - that's added separately.
 * @param {string} context - RAG context (XML chunks)
 * @returns {Array<{role: string, content: string}>}
 */
export const buildBasePrompts = (context = "") => {
  // Extract links from context.
  const linkPattern =
    /<CHUNK><URL>([^<]+)<\/URL><TITLE>([^<]+)<\/TITLE><CONTENT>/g;
  let links = "";
  let match;
  while ((match = linkPattern.exec(context)) !== null) {
    links += `- [${match[2]}](${match[1]})\n`;
  }

  return [
    {
      role: "system",
      content: `You are a helpful assistant for Nearform employees and those interested in Nearform. All responses must only use facts and URLs from retrieved CHUNKs. URLs must be real and explicitly present in the CHUNKs.

## Brand Rules
- Nearform has acquired Formidable. Replace "Formidable", "Formidable Labs", or "Nearform Commerce" with "Nearform".
- Always use "Nearform" (lowercase 'f'), never "NearForm". Even if sources use "NearForm", answer with "Nearform".

## Context Format
Content is provided as XML CHUNKs. Each <CHUNK> contains:
- <URL>: Reference link
- <TITLE>: Post title
- <CONTENT>: Text content

## How to Use Context
- Use information from <CHUNK><CONTENT> wherever possible.
- Chunks are ranked by relevance; prefer earlier chunks but use the most relevant content from any chunk.
- If no relevant information exists, state that you don't have enough information to answer.

## Citation Rules
- Do NOT add links unless they appear in <CHUNK><URL>.
- You MUST cite sources using markdown links: [TITLE](URL)
- Each URL may appear at most ONCE in your answer. Chunks may repeat URLs; do not duplicate links.
- Assistant provides a markdown list of acceptably formatted links to use. Use ONLY those links for responses.

## URL Normalization
When citing Nearform URLs:
- Do NOT hallucinate URLs. Only cite URLs explicitly present in context.
- URLs must begin with "https://nearform.com/" — remove "www." or "commerce." prefixes.
- Valid path segments: /insights/, /digital-community/, /work/, /services/
- Replace "/blog/" with "/insights/". For unknown paths, default to "/insights/".`,
    },
    {
      role: "assistant",
      content: `The posts chunk content is as follows:\n\n${context}`,
    },
    {
      role: "assistant",
      content: `You may only choose links from the following list of urls from the <CHUNKS />: ${links}`,
    },
  ];
};

/**
 * Build full messages array for OpenAI-style completions.
 * Includes base prompts plus the user query.
 * @param {Object} options
 * @param {string} options.query - User's query
 * @param {string} options.context - RAG context (XML chunks)
 * @returns {Array<{role: string, content: string}>}
 */
const createMessages = ({ query, context = "" }) => [
  ...buildBasePrompts(context),
  {
    role: "user",
    content: query,
  },
];

export const BASE_TOKEN_ESTIMATE = estimateTokens(
  JSON.stringify(createMessages({ query: "" })),
);

/**
 * Build XML context string from search chunks with token limiting.
 * @param {Object} options
 * @param {Array} options.chunks - Array of chunk objects from search
 * @param {string} options.query - User query (for token estimation)
 * @param {string} options.provider - LLM provider key
 * @param {string} options.model - Model ID
 * @param {number} [options.maxChunks] - Optional max number of chunks to include
 * @param {boolean} [options.forMultiTurn=false] - Use larger cushion for multi-turn
 * @returns {Promise<{context: string, usedChunks: Array, chunkCount: number, tokenEstimate: number, tokenBreakdown: {basePromptTokens: number, queryTokens: number, chunksTokens: number, totalTokens: number}}>}
 */
export const buildContextFromChunks = async ({
  chunks,
  query,
  provider,
  model,
  maxChunks,
  forMultiTurn = false,
}) => {
  const modelCfg = getModelCfg({ provider, model });
  const maxTokens = modelCfg.maxTokens;
  const cushion = forMultiTurn
    ? getMultiTurnCushion(maxTokens)
    : TOKEN_CUSHION_CHAT;

  // For multi-turn, limit context to MULTI_TURN_CONTEXT_RATIO of available space
  // leaving the remainder for conversation history growth across turns
  const availableTokens = maxTokens - cushion;
  const maxContextTokens = forMultiTurn
    ? Math.floor(availableTokens * MULTI_TURN_CONTEXT_RATIO)
    : availableTokens;
  let totalContextTokens = BASE_TOKEN_ESTIMATE + estimateTokens(query);

  if (totalContextTokens > maxContextTokens) {
    throw new Error(`Query is too long: ${query}`);
  }

  const usedChunks = [];
  const chunksToProcess = maxChunks ? chunks.slice(0, maxChunks) : chunks;

  // Track context entries by slug for dedup modes
  // Each entry: { url, content, tokenCount }
  const contextEntries = [];
  const seenSlugs = new Map(); // slug -> index in contextEntries

  for (const chunk of chunksToProcess) {
    const post = await getPost(chunk.slug);
    const chunkText = getChunk(post.content, chunk.start, chunk.end).join(
      "\n\n",
    );
    const chunkTokens = estimateTokens(chunkText);

    // Check if we've seen this post before
    const existingIndex = seenSlugs.get(chunk.slug);

    if (existingIndex !== undefined) {
      // Handle duplicate post based on dedup mode
      if (CHUNK_DEDUP_MODE === "skip") {
        // Skip this chunk entirely
        continue;
      } else if (CHUNK_DEDUP_MODE === "combine") {
        // Check if combining would exceed token limit
        if (totalContextTokens + chunkTokens > maxContextTokens) {
          break;
        }
        // Append to existing entry with separator
        const entry = contextEntries[existingIndex];
        entry.content += CHUNK_COMBINE_SEPARATOR + chunkText;
        totalContextTokens += chunkTokens;
        usedChunks.push(chunk);
        continue;
      }
      // "duplicate" mode falls through to add as new entry
    }

    // Check if over max context
    if (totalContextTokens + chunkTokens > maxContextTokens) {
      break;
    }

    // Add new context entry
    const entryIndex = contextEntries.length;
    contextEntries.push({
      url: post.href,
      title: post.title,
      content: chunkText,
    });
    seenSlugs.set(chunk.slug, entryIndex);

    // Accumulate tokens and track chunk
    totalContextTokens += chunkTokens;
    usedChunks.push(chunk);
  }

  // Build final context string from entries
  const context = contextEntries
    .map(
      (entry) =>
        `<CHUNK><URL>${entry.url}</URL><TITLE>${entry.title}</TITLE><CONTENT>${entry.content}</CONTENT></CHUNK>`,
    )
    .join("");

  // Calculate granular token breakdown
  const queryTokens = estimateTokens(query);
  const chunksTokens = totalContextTokens - BASE_TOKEN_ESTIMATE - queryTokens;

  return {
    context,
    usedChunks,
    chunkCount: usedChunks.length,
    tokenEstimate: totalContextTokens,
    // Granular token breakdown for UI display
    tokenBreakdown: {
      basePromptTokens: BASE_TOKEN_ESTIMATE,
      queryTokens,
      chunksTokens,
      totalTokens: totalContextTokens,
    },
  };
};

/**
 * Rebuild context with a reduced number of chunks.
 * Used for dynamic context reduction in multi-turn conversations.
 * @param {Object} options
 * @param {Array} options.chunks - Original array of chunk objects from search
 * @param {string} options.query - User query (for token estimation)
 * @param {string} options.provider - LLM provider key
 * @param {string} options.model - Model ID
 * @param {number} options.targetChunkCount - Target number of chunks (will be clamped to MIN_CONTEXT_CHUNKS)
 * @returns {Promise<{context: string, usedChunks: Array, chunkCount: number, tokenEstimate: number, tokenBreakdown: {basePromptTokens: number, queryTokens: number, chunksTokens: number, totalTokens: number}}>}
 */
export const rebuildContextWithLimit = async ({
  chunks,
  query,
  provider,
  model,
  targetChunkCount,
}) => {
  const effectiveMax = Math.max(targetChunkCount, MIN_CONTEXT_CHUNKS);
  return buildContextFromChunks({
    chunks,
    query,
    provider,
    model,
    maxChunks: effectiveMax,
    forMultiTurn: true,
  });
};

if (DEBUG_TOKENS) {
  // eslint-disable-next-line no-undef
  console.log(
    "DEBUG(TOKENS) chat.js - BASE_TOKEN_ESTIMATE:",
    BASE_TOKEN_ESTIMATE,
  );
}

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

  // Get chunks
  const searchResults = await search({
    query,
    postType,
    minDate,
    categoryPrimary,
    withContent,
  });

  // Start metadata based off search results.
  const metadata = { ...searchResults.metadata };
  metadata.elapsed.chunks = new Date() - start;

  // Build context from chunks (handles token limiting and dedup modes)
  const contextResult = await buildContextFromChunks({
    chunks: searchResults.chunks,
    query,
    provider,
    model,
  });
  const { context, tokenEstimate: totalContextTokens } = contextResult;

  // For debug logging
  const modelCfg = getModelCfg({ provider, model });
  const maxContextTokens = modelCfg.maxTokens - TOKEN_CUSHION_CHAT;

  if (DEBUG_TOKENS) {
    // eslint-disable-next-line no-undef
    console.log(
      "DEBUG(TOKENS) chat.js - estimated input tokens:",
      JSON.stringify(
        {
          provider,
          model,
          baseTokens: BASE_TOKEN_ESTIMATE,
          queryTokens: estimateTokens(query),
          contextTokens:
            totalContextTokens - BASE_TOKEN_ESTIMATE - estimateTokens(query),
          totalContextTokens,
          maxContextTokens,
          headroom: maxContextTokens - totalContextTokens,
        },
        null,
        2,
      ),
    );
  }

  // Store context in metadata for conversation session reuse
  metadata.context = context;

  // Yield search info.
  yield { type: "posts", message: searchResults.posts };
  yield { type: "chunks", message: searchResults.chunks };

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
  let chunkCount = 0;
  let usageReceived = false;
  let reportedInputTokens = 0;
  let reportedOutputTokens = 0;
  for await (const chunk of stream) {
    chunkCount++;
    if (chunk.choices[0]?.delta?.content) {
      metadata.elapsed.tokensFirst =
        metadata.elapsed.tokensFirst ?? new Date() - start;
      yield { type: "data", message: chunk.choices[0].delta.content };
    }
    if (chunk.usage) {
      usageReceived = true;
      reportedInputTokens = chunk.usage.prompt_tokens ?? 0;
      reportedOutputTokens = chunk.usage.completion_tokens ?? 0;

      if (DEBUG_TOKENS) {
        // eslint-disable-next-line no-undef
        console.log(
          "DEBUG(TOKENS) chat.js - raw usage from provider:",
          JSON.stringify(
            {
              provider,
              model,
              rawUsage: chunk.usage,
              chunkNumber: chunkCount,
            },
            null,
            2,
          ),
        );
      }

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

  if (DEBUG_TOKENS) {
    if (!usageReceived) {
      // eslint-disable-next-line no-undef
      console.warn(
        "DEBUG(TOKENS) chat.js - NO usage received from provider!",
        JSON.stringify(
          {
            provider,
            model,
            totalChunks: chunkCount,
          },
          null,
          2,
        ),
      );
    }

    const inputDiscrepancy =
      reportedInputTokens > 0
        ? (
            ((reportedInputTokens - totalContextTokens) / totalContextTokens) *
            100
          ).toFixed(1)
        : "N/A";
    // eslint-disable-next-line no-undef
    console.log(
      "DEBUG(TOKENS) chat.js - TOKEN SUMMARY:",
      JSON.stringify(
        {
          provider,
          model,
          estimated: {
            inputTokens: totalContextTokens,
          },
          reported: {
            inputTokens: reportedInputTokens,
            outputTokens: reportedOutputTokens,
          },
          inputDiscrepancy:
            inputDiscrepancy !== "N/A"
              ? `${inputDiscrepancy}%`
              : inputDiscrepancy,
          usageReceived,
        },
        null,
        2,
      ),
    );
  }

  metadata.elapsed.tokensLast = new Date() - start;

  yield { type: "metadata", message: metadata };
}

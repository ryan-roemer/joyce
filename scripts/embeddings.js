/* global console:false,process:false */
/**
 * Generate embeddings for all posts from posts.json.
 *
 * Usage:
 *   node scripts/embeddings.js --output=FILE
 *
 * Options:
 *   --output=FILE   Output file path (required)
 *
 * Reads posts from public/data/posts.json and generates an embeddings object
 * keyed by slug, with each entry containing an embeddings array.
 *
 * Example:
 * ```
 * $ node scripts/embeddings.js --output=public/data/posts-embeddings.json
 * ```
 *
 * Token notes:
 * The `gte-small` tokenizer has a max token limit of 512, but ignores tokens over the limit.
 * We use the `llm-splitter` library to split the text into chunks, and then generate tokens
 * for each chunk. We've got some debugging stats that show for the following configuration
 * we only have a handful of chunks over the limit, and most not by much. This means that
 * the chunks should be good enough for our purposes.
 *
 * - Config: maxTokens=512, cushion=25, overlap=10, chunkSize=487
 * - Token counts - min: 3, max: 584, avg: 331.73
 * - Total chunks: 5155
 * - Chunks over maxTokens (512): 8
 * -   Counts: 580, 516, 541, 538, 541, 539, 584, 519
 * - Percentage over maxTokens: 0.16%
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { pipeline, AutoTokenizer } from "@xenova/transformers";
import { split } from "llm-splitter";
import config, { TOKEN_CUSHION_EMBEDDINGS } from "../public/shared-config.js";

const { dirname } = import.meta;

const TOKEN_CHUNK_OVERLAP = 10;
const TOKEN_CHUNK_SIZE = config.embeddings.maxTokens - TOKEN_CUSHION_EMBEDDINGS;

const tokenizer = await AutoTokenizer.from_pretrained(config.embeddings.model);

// Specifically normalize the tokens for the gte-small tokenizer.
const normalizeTokenGteSmall = (token, i, tokens) => {
  if (i === 0 && token === "[CLS]") {
    return "";
  } else if (token === "[UNK]") {
    return "";
  } else if (i === tokens.length - 1 && token === "[SEP]") {
    return "";
  } else if (token.startsWith("##")) {
    return token.slice(2);
  }

  return token;
};

const splitter = (text) => {
  const tokenInts = tokenizer.encode(text);
  const tokens = tokenInts
    .map((id) => tokenizer.decode([id]))
    .map(normalizeTokenGteSmall);

  return tokens;
};

const generateTokens = (lines) => {
  return lines.map((line) => splitter(line));
};

const DEBUG_TOKENS = true;
const TOKEN_COUNTS = [];

const logTokenStats = () => {
  const totalChunks = TOKEN_COUNTS.length;
  const minTokens = Math.min(...TOKEN_COUNTS);
  const maxTokens = Math.max(...TOKEN_COUNTS);
  const avgTokens = (
    TOKEN_COUNTS.reduce((a, b) => a + b, 0) / totalChunks
  ).toFixed(2);
  const overMax = TOKEN_COUNTS.filter(
    (count) => count > config.embeddings.maxTokens,
  );
  const overMaxCount = overMax.length;
  const overMaxPct = ((overMaxCount / totalChunks) * 100).toFixed(2);

  console.log("\n## Token Debug Stats");
  console.log(
    `Config: maxTokens=${config.embeddings.maxTokens}, cushion=${TOKEN_CUSHION_EMBEDDINGS}, overlap=${TOKEN_CHUNK_OVERLAP}, chunkSize=${TOKEN_CHUNK_SIZE}`,
  );
  console.log(
    `Token counts - min: ${minTokens}, max: ${maxTokens}, avg: ${avgTokens}`,
  );
  console.log(`Total chunks: ${totalChunks}`);
  console.log(
    `Chunks over maxTokens (${config.embeddings.maxTokens}): ${overMaxCount}`,
  );
  if (overMaxCount > 0) {
    console.log(`  Counts: ${overMax.join(", ")}`);
  }
  console.log(`Percentage over maxTokens: ${overMaxPct}%`);
};

const getChunks = (lines) => {
  // Note: We lower case the lines to match the tokenizer, but our `getChunk` calls
  // have normal, cased text.
  const chunks = split(
    lines.map((line) => line.toLocaleLowerCase()),
    {
      chunkSize: TOKEN_CHUNK_SIZE,
      chunkOverlap: TOKEN_CHUNK_OVERLAP,
      splitter,
    },
  );

  if (DEBUG_TOKENS) {
    chunks.forEach(({ text }) => {
      const tokenItems = generateTokens(text);
      tokenItems.forEach((tokens) => {
        TOKEN_COUNTS.push(tokens.length);
      });
    });
  }

  return chunks;
};

/**
 * Generate embeddings for a given text using the extractor
 * @param {any} extractor - The feature extraction pipeline
 * @param {string} text - The text to generate embeddings for
 * @returns {Promise<number[]>} - The embedding vector as an array
 */
const generateEmbeddings = async (extractor, lines) => {
  const output = await extractor(lines.join("\n"), {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(output.data);
};

const main = async () => {
  // Parse CLI arguments
  const { values } = parseArgs({
    options: {
      output: { type: "string", default: "" },
    },
    strict: false,
  });

  const outputPath = values.output;

  if (!outputPath) {
    console.error("Error: --output flag is required");
    console.error("Usage: node scripts/embeddings.js --output=FILE");
    process.exit(1);
  }

  // Read posts.json
  const postsPath = resolve(dirname, "../public/data/posts.json");
  const postsContent = await readFile(postsPath, "utf8");
  const posts = JSON.parse(postsContent);

  console.log("## Generating Embeddings");

  // Initialize the feature-extraction pipeline
  const { model } = config.embeddings;
  console.log(`Loading model: ${model}...`);
  const modelLoadStart = performance.now();
  const extractor = await pipeline("feature-extraction", model);
  const modelLoadTime = ((performance.now() - modelLoadStart) / 1000).toFixed(
    2,
  );
  console.log(`Model loaded. (${modelLoadTime}s)`);

  // Generate embeddings object keyed by slug
  const slugs = Object.keys(posts);
  const result = {};
  console.log(`Generating embeddings for ${slugs.length} posts...`);
  const processStart = performance.now();
  let lastCheckpoint = processStart;
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const post = posts[slug];
    let chunks = [];
    try {
      // Just store the start and end indices of the chunks and add the embeddings.
      chunks = getChunks(post.content);
      for (const chunk of chunks) {
        const embeddings = await generateEmbeddings(extractor, chunk.text);
        delete chunk.text;
        chunk.embeddings = embeddings;
      }
    } catch (error) {
      console.error("(E) getChunks: ", slug);
      throw error;
    }

    result[slug] = { chunks };

    if ((i + 1) % 100 === 0) {
      const now = performance.now();
      const incrementTime = ((now - lastCheckpoint) / 1000).toFixed(2);
      lastCheckpoint = now;
      console.log(
        `Processed ${i + 1}/${slugs.length} posts... (${incrementTime}s)`,
      );
    }
  }
  const totalTime = ((performance.now() - processStart) / 1000).toFixed(2);
  console.log(`Completed processing ${slugs.length} posts. (${totalTime}s)`);

  // Convert to JSON string with pretty print, but keep embeddings arrays compact
  const jsonString = JSON.stringify(
    result,
    (key, value) => {
      if (key === "embeddings" && Array.isArray(value)) {
        return `__EMBEDDINGS_${JSON.stringify(value)}__`;
      }
      return value;
    },
    2,
  );
  const output = jsonString.replace(/"__EMBEDDINGS_(\[.*?\])__"/g, "$1");

  // Write to output file
  await writeFile(resolve(outputPath), output, "utf8");
  console.log(
    `Wrote embeddings for ${Object.keys(result).length} posts to ${outputPath}`,
  );
  if (DEBUG_TOKENS) {
    logTokenStats();
  }
};

// Run script
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

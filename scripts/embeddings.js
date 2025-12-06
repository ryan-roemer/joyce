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
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { pipeline, AutoTokenizer } from "@xenova/transformers";
import { split, getChunk } from "llm-splitter";
import { normalizeDiacritics } from "normalize-text"; // TODO: REMOVE AND PUT UPSTREAM.
import config, { TOKEN_CUSHION_EMBEDDINGS } from "../public/shared-config.js";

const { dirname } = import.meta;

const TOKEN_CHUNK_OVERLAP = 10;
const TOKEN_CHUNK_SIZE = config.embeddings.maxTokens - TOKEN_CUSHION_EMBEDDINGS;

const tokenizer = await AutoTokenizer.from_pretrained(config.embeddings.model);

// TODO: Refactor and document codes for gte-small tokenizer.
const normalizeToken = (token, i, tokens) => {
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
    .map(normalizeToken);

  return tokens;
};

// TODO: REMOVE
const generateTokens = (lines) => {
  return lines.map((line) => splitter(line));
};

const getChunks = (lines) => {
  try {
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

    // TODO: REMOVE -- SANITY check lower casing.
    chunks.forEach(({ start, end, text }) => {
      let getText = getChunk(lines, start, end);
      //  console.log("TODO getText", getText);
      getText = getText.map((line) => line.toLocaleLowerCase());
      if (JSON.stringify(getText) !== JSON.stringify(text)) {
        console.error("(E) getChunks: ", getText, text);
      }
    });

    return chunks;
  } catch (error) {
    console.error(
      "(E) getChunks: ",
      JSON.stringify(generateTokens(lines), null, 2),
    );
    throw error;
  }
};

/**
 * Generate embeddings for a given text using the extractor
 * @param {any} extractor - The feature extraction pipeline
 * @param {string} text - The text to generate embeddings for
 * @returns {Promise<number[]>} - The embedding vector as an array
 */
const generateEmbeddings = async (extractor, lines) => {
  // TODO: reconsider joining lines.
  // TODO: Switch to chunks.
  const output = await extractor(lines.join("\n"), {
    pooling: "mean",
    normalize: true,
  });
  //console.log("TODO EMBEDDINGS", output);
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
  let posts = JSON.parse(postsContent);
  //posts = { "digital-community-09-29-london-formidable-has-landed": posts["digital-community-09-29-london-formidable-has-landed"] };
  Object.entries(posts).forEach(([slug, post]) => {
    const content = post.content.map((line) => {
      line = normalizeDiacritics(line);
      return line;
    });
    posts[slug] = { ...post, content };
  });

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
    const embeddings = await generateEmbeddings(extractor, post.content);
    const tokens = generateTokens(post.content); // TODO: REMOVE
    let chunks = [];
    try {
      chunks = getChunks(post.content); // TODO: REMOVE
    } catch (error) {
      console.error("(E) getChunks: ", slug);
      throw error;
    }

    result[slug] = { embeddings, tokens, chunks };

    if ((i + 1) % 100 === 0) {
      const now = performance.now();
      const incrementTime = ((now - lastCheckpoint) / 1000).toFixed(2);
      lastCheckpoint = now;
      console.log(
        `Processed ${i + 1}/${slugs.length} posts... (${incrementTime}s)`,
      );
      // break; // TODO REMOVE
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
};

// Run script
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

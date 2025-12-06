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
import { pipeline } from "@xenova/transformers";
import config from "../public/shared-config.js";

const { dirname } = import.meta;

/**
 * Generate embeddings for a given text using the extractor
 * @param {any} extractor - The feature extraction pipeline
 * @param {string} text - The text to generate embeddings for
 * @returns {Promise<number[]>} - The embedding vector as an array
 */
const generateEmbeddings = async (extractor, text) => {
  const output = await extractor(text, {
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

  // Initialize the feature-extraction pipeline
  const model = config.embeddings.model;
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

    // TODO(search): Need to look at max tokens and chunking, etc.
    const text = post.content.join("\n");
    const embeddings = await generateEmbeddings(extractor, text);
    result[slug] = { embeddings };
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
};

// Run script
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

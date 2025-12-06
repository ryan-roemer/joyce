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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Generate stub embeddings (array of 10 zeros)
 * @returns {number[]} - Array of 10 zeros
 */
const generateEmbeddings = () => {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
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
  const postsPath = resolve(__dirname, "../public/data/posts.json");
  const postsContent = await readFile(postsPath, "utf8");
  const posts = JSON.parse(postsContent);

  // Generate embeddings object keyed by slug
  const result = {};
  for (const slug of Object.keys(posts)) {
    const embeddings = generateEmbeddings();
    result[slug] = { embeddings };
  }

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

/* global performance:false */
import { create, insertMultiple, search as oramaSearch } from "@orama/orama";
import { pipeline } from "@xenova/transformers";

import { getAndCache } from "../../../shared-util.js";
import config from "../../../shared-config.js";
import { getPosts, getPostsEmbeddings } from "./posts.js";

const MAX_CHUNKS = 50;

// Embeddings extractor (feature-extraction pipeline)
export const getExtractor = getAndCache(async () => {
  const { model } = config.embeddings;
  const extractor = await pipeline("feature-extraction", model);
  return extractor;
});

// Posts database (full-text search)
export const getPostsDb = getAndCache(async () => {
  const postsObj = await getPosts();
  const posts = Object.values(postsObj);

  const db = await create({
    schema: {
      href: "string",
      postType: "enum",
      slug: "string",
      date: "string",
      title: "string",
      authors: "string[]",
      content: "string[]",
      categories: {
        primary: "string",
        others: "string[]",
      },
    },
  });

  await insertMultiple(db, posts);

  return db;
});

// Chunks database (vector search)
export const getChunksDb = getAndCache(async () => {
  const [embeddingsObj, postsObj] = await Promise.all([
    getPostsEmbeddings(),
    getPosts(),
  ]);

  // Flatten chunks: each chunk becomes a document with slug reference and post metadata
  const chunks = Object.entries(embeddingsObj).flatMap(([slug, { chunks }]) => {
    const post = postsObj[slug];
    return chunks.map((chunk) => ({
      slug,
      date: post?.date,
      postType: post?.postType,
      categories: post?.categories,
      ...chunk,
    }));
  });

  const db = await create({
    schema: {
      // Post.
      slug: "string",
      date: "string",
      postType: "string",
      categories: {
        primary: "string",
        others: "string[]",
      },

      // Chunk.
      start: "number",
      end: "number",
      embeddings: "vector[384]",
    },
  });

  await insertMultiple(db, chunks);

  return db;
});

export const getDb = getAndCache(async () => {
  const [postsDb, chunksDb] = await Promise.all([getPostsDb(), getChunksDb()]);

  const db = {
    posts: postsDb,
    chunks: chunksDb,
  };

  return db;
});

/**
 * Search for posts matching a query.
 * @param {Object} params
 * @param {string} params.query
 * @param {string[]} params.postType
 * @param {string} params.minDate
 * @param {string[]} params.categoryPrimary
 * @param {boolean} params.withContent
 * @returns {Promise<{posts: Object, chunks: Array, metadata: Object}>}
 */
// Unused params: @param {string} params.datastore
export const search = async ({
  query,
  postType,
  minDate,
  categoryPrimary,
  withContent,
}) => {
  const db = await getDb();
  const { chunks: chunksDb } = db;
  const extractor = await getExtractor();
  const postsData = await getPosts();

  // 1. Generate query embedding
  const embeddingStart = performance.now();
  const output = await extractor(query, { pooling: "mean", normalize: true });
  const queryEmbedding = Array.from(output.data);
  const embeddingQuery = performance.now() - embeddingStart;

  // 2. Build where clause for filtering
  const where = {};
  if (postType?.length) {
    where.postType = postType;
  }
  if (categoryPrimary?.length) {
    where["categories.primary"] = categoryPrimary;
  }
  if (minDate) {
    where.date = { gte: minDate };
  }

  // 3. Vector search on chunks DB
  const databaseStart = performance.now();
  const results = await oramaSearch(chunksDb, {
    mode: "vector",
    vector: { value: queryEmbedding, property: "embeddings" },
    limit: MAX_CHUNKS,
    where: Object.keys(where).length > 0 ? where : undefined,
  });
  const databaseQuery = performance.now() - databaseStart;

  // 4. Build posts map and chunks array
  const postsMap = {};
  const chunksArray = [];
  const similarities = [];

  for (const hit of results.hits) {
    const { document, score: similarity } = hit;
    const { slug, start, end } = document;

    similarities.push(similarity);

    // Add chunk to array
    // TODO: add embeddingNumTokens when available on chunk objects
    chunksArray.push({ slug, start, end, similarity });

    // Build/update post entry
    if (!postsMap[slug]) {
      const post = postsData[slug];
      if (post) {
        postsMap[slug] = {
          title: post.title,
          href: post.href,
          date: post.date,
          // TODO(ORG): No Org Presently -- org: post.org,
          postType: post.postType,
          categories: post.categories,
          ...(withContent ? { content: post.content } : {}),
          similarityMax: similarity,
        };
      }
    } else if (similarity > postsMap[slug].similarityMax) {
      postsMap[slug].similarityMax = similarity;
    }
  }

  // 5. Sort posts by similarityMax descending
  const sortedEntries = Object.entries(postsMap).sort(
    ([, a], [, b]) => b.similarityMax - a.similarityMax,
  );
  const posts = Object.fromEntries(sortedEntries);

  // 6. Compute similarity stats
  const similarityStats =
    similarities.length > 0
      ? {
          min: Math.min(...similarities),
          max: Math.max(...similarities),
          avg: similarities.reduce((a, b) => a + b, 0) / similarities.length,
        }
      : { min: 0, max: 0, avg: 0 };

  return {
    posts,
    chunks: chunksArray,
    metadata: {
      elapsed: {
        embeddingQuery,
        databaseQuery,
      },
      chunks: {
        similarity: similarityStats,
      },
    },
  };
};

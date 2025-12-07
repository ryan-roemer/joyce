import { create, insertMultiple } from "@orama/orama";
import { pipeline } from "@xenova/transformers";

import { getAndCache } from "../../../shared-util.js";
import config from "../../../shared-config.js";
import { getPosts, getPostsEmbeddings } from "./posts.js";

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
      postType: "enum",
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
  const { chunks } = db; // TODO: ONLY DO CHUNKS and remove posts???
  const extractor = await getExtractor();

  // TODO: HERE -- IMPLEMENT
  console.log("(I) chunks: ", chunks.data.docs.docs);

  return {
    posts: [],
    chunks: [],
    metadata: {},
  };
};

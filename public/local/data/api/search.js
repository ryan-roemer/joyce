import { create, insertMultiple } from "@orama/orama";

import { getAndCache } from "../../../shared-util.js";
import { getPosts, getPostsEmbeddings } from "./posts.js";

// Posts database (full-text search)
export const getPostsDb = getAndCache(async () => {
  const postsObj = await getPosts();
  const posts = Object.values(postsObj);

  const db = await create({
    schema: {
      href: "string",
      postType: "string",
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
  const embeddingsObj = await getPostsEmbeddings();

  // Flatten chunks: each chunk becomes a document with slug reference
  const chunks = Object.entries(embeddingsObj).flatMap(([slug, { chunks }]) =>
    chunks.map((chunk) => ({
      slug,
      start: chunk.start,
      end: chunk.end,
      embeddings: chunk.embeddings,
    })),
  );

  const db = await create({
    schema: {
      slug: "string",
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

  console.log("TODO ORAMA", db); // eslint-disable-line no-undef

  return db;
});

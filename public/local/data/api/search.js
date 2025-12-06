import { create, insertMultiple } from "@orama/orama";

import { getAndCache } from "../../../shared-util.js";
import { getPosts } from "./posts.js";

// TODO(EMBEDDINGS): Split the script to do by chunks.
// TODO(EMBEDDINGS): Revise the scheme to handle chunks...
export const getDb = getAndCache(async () => {
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

  console.log("TODO ORAMA", db.data.docs.docs); // eslint-disable-line no-undef

  return db;
});

import { create, insertMultiple } from "@orama/orama";

import { getAndCache } from "../../../shared-util.js";
import { getPosts } from "./posts.js";

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

  return db;
});

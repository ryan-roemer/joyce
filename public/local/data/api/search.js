import { getAndCache } from "../../../shared-util.js";
import { getPosts, getPostsEmbeddings } from "./posts.js";

export const getDb = getAndCache(async () => {
  await getPosts();
  await getPostsEmbeddings();
  return {};
});

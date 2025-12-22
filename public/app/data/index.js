// Public API for UI layer
// Internal functions (buildContextFromChunks, wrapQueryForRag, etc.)
// are encapsulated in createChatSession facade
export {
  search,
  chat,
  posts,
  createChatSession,
} from "../../local/data/api/index.js";

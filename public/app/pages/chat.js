import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";

import { html, getQuerySetter } from "../util/html.js";
import { Page } from "../components/page.js";
import {
  ModelChatSelectDropdown,
  TemperatureDropdown,
  PostMinDateDropdown,
  PostTypeSelectDropdown,
  PostCategoryPrimarySelectDropdown,
  QueryField,
  ChatInputForm,
} from "../components/forms.js";
import { Answer } from "../components/answer.js";
import { PostsFound } from "../components/posts-found.js";
import {
  DownloadPostsCsv,
  JsonDataLink,
} from "../components/posts-download.js";
import { useSettings } from "../hooks/use-settings.js";
import { useConfig } from "../contexts/config.js";
import { useLoading } from "../../local/app/context/loading.js";
import { LoadingButton } from "../../local/app/components/loading/button.js";
import { Alert } from "../components/alert.js";
import { SuggestedQueries } from "../components/suggested-queries.js";
import { LoadingBubble } from "../components/loading-bubble.js";
import { QueryDisplay } from "../components/query-display.js";
import { Description } from "../components/description.js";
import { searchResultsToPosts } from "../data/util.js";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_TEMPERATURE,
  getModelCfg,
  FEATURES,
} from "../../config.js";
import {
  search,
  buildContextFromChunks,
  wrapQueryForRag,
  createConversationSession,
  ConversationLimitError,
} from "../data/index.js";

// TODO: REFACTOR TO PUT IN SUBMIT???
const setQueryValue = getQuerySetter("query");

const SUGGESTIONS = [
  "Tell me 2 sentences about Nearform's expertise in using AI for software development.",
  "Give me a single paragraph about Nearform's React and React Native expertise.",
  "Give me 3 articles by Nearform on AI in engineering teams.",
];

export const ShortDescription = () => html`
  <p>
    Our <${Link} to="/chat">chat</${Link}> page uses Retrieval-Augmented Generation (RAG) to
    generate text responses based on a user query and context. The context is supplied by the
    application, which in our case is to create embeddings from the user query, match similar
    blog/work posts using the same approach as in the <${Link} to="/search">search</${Link}> page,
    and then taking as much content from those similar posts to add in to the overall prompt we send
    to an AI model to get an answer.
  </p>
`;

const DescriptionButton = () => {
  const [settings] = useSettings();
  const { isDeveloperMode } = settings;

  return html`
    <${Description}>
      <${ShortDescription} />
      <p>Notable options:</p>
      <ul>
        <li>
          <i className="iconoir-edit"></i> <strong>Query</strong>: Enter your question or request in the text area to generate AI responses based on our content.
        </li>
        <li>
          <i className="iconoir-multiple-pages"></i> <strong>Post Types</strong>: Filter content by selecting specific types of posts (Services, Work, Blogs) to include in the AI's context.
        </li>
        <li>
          <i className="iconoir-list-select"></i> <strong>Categories</strong>: Filter content by selecting specific categories to narrow down the posts used for generating responses.
        </li>
        <li>
          <i className="iconoir-calendar"></i> <strong>Date</strong>: Filter content to only include posts published on or after the selected date.
        </li>
        <li>
          <i className="iconoir-sparks"></i> <strong>Model</strong>: Choose the AI language model. Local models must be loaded before use, which may take a moment on first request. Different models offer varying speed, quality, and memory trade-offs.
        </li>
        ${
          isDeveloperMode &&
          html`
            <li>
              <i className="iconoir-temperature-high"></i>
              <strong>Temperature</strong>: Control the creativity and
              randomness of AI responses, from 0 (more focused and
              deterministic) to 1 (more creative and varied).
            </li>
          `
        }
      </ul>
    </${Description}>
  `;
};

export const Chat = () => {
  // Conversation state - array of Q&A entries
  // Each entry: { query: string, answer: string, queryInfo: object, isLoading: boolean }
  // TODO(TOKENS): Track conversation token usage
  // - Running total of tokens used across all turns
  // - Available tokens remaining (maxTokens - used)
  // - Values come from: model config (maxTokens), API responses (usage)
  // - May not always be known (some providers don't report usage)
  // - Consider displaying in UI when isDeveloperMode is true
  const [conversation, setConversation] = useState([]);
  const [isFetching, setIsFetching] = useState(false);

  // RAG context - only fetched on first question, persists until "New"
  // TODO(CONVO): Decide posts display strategy for conversations
  // Options: show latest only, accumulate all, or per-answer buttons
  // For now, showing posts from the first query only.
  const [posts, setPosts] = useState(null);
  const [searchData, setSearchData] = useState(null);
  const [analyticsDates, setAnalyticsDates] = useState({
    start: null,
    end: null,
  });

  // Form state - locked after first Q&A
  const [selectedPostTypes, setSelectedPostTypes] = useState([]);
  const [selectedCategoryPrimary, setSelectedCategoryPrimary] = useState([]);
  const [modelObj, setModelObj] = useState(DEFAULT_CHAT_MODEL);
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [minDate, setMinDate] = useState("");

  // Other state
  const [err, setErr] = useState(null);

  // Derived state
  const conversationsEnabled = FEATURES.chat.conversations;
  const isConversationActive = conversation.length > 0;
  const hasCompletions = conversation.some((entry) => entry.answer);
  // Form inputs are only locked when conversation is active AND conversations feature is enabled
  const formInputsLocked = isConversationActive && conversationsEnabled;

  const [settings] = useSettings();
  const { isDeveloperMode } = settings;
  // TODO(CHAT): useConfig() depends on remote /api/config - needs local replacement
  const config = useConfig();
  const providers = new Set(
    Object.entries(config.providers)
      .filter(([, { enabled }]) => enabled)
      .map(([provider]) => provider),
  );

  // Model loading status
  const { getStatus, getError, startLoading } = useLoading();
  const modelResourceId = `llm_${modelObj.model}`;
  const modelStatus = getStatus(modelResourceId);
  const isModelLoaded = modelStatus === "loaded";

  // Track when we're waiting for model to load before chat
  const [isLoadingModelForChat, setIsLoadingModelForChat] = useState(false);
  const pendingQueryRef = useRef(null);

  // Conversation session for multi-turn (created lazily in executeAskMore)
  const sessionRef = useRef(null);

  // Reset all outputs for a new conversation
  const resetForNewConversation = () => {
    setQueryValue("");
    setConversation([]);
    setPosts(null);
    setSearchData(null);
    setAnalyticsDates({ start: null, end: null });
    setErr(null);
    // Clean up conversation session
    if (sessionRef.current) {
      sessionRef.current.destroy();
      sessionRef.current = null;
    }
  };

  // Update the last conversation entry with the answer
  const updateLastEntry = (updates) => {
    setConversation((prev) => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0) {
        updated[lastIdx] = { ...updated[lastIdx], ...updates };
      }
      return updated;
    });
  };

  // Execute the actual chat query (first question in conversation)
  // Uses unified session approach - same session for first and follow-up messages
  const executeChatQuery = async (queryParams) => {
    const { query, postType, categoryPrimary } = queryParams;
    const start = new Date();

    // Reset for new conversation and add the first entry
    resetForNewConversation();
    setConversation([
      { query, answer: null, queryInfo: null, isLoading: true },
    ]);
    setIsFetching(true);

    try {
      // Step 1: RAG search
      const searchResults = await search({
        query,
        postType,
        minDate,
        categoryPrimary,
        withContent: false,
      });
      const { posts: fetchedPosts, chunks, metadata } = searchResults;
      metadata.elapsed.search = new Date() - start;

      // Step 2: Build context from chunks
      const context = await buildContextFromChunks({
        chunks,
        query,
        provider: modelObj.provider,
        model: modelObj.model,
      });
      metadata.context = context;

      // Update UI with search results
      setSearchData({ posts: fetchedPosts, chunks, metadata });
      setPosts(searchResultsToPosts({ posts: fetchedPosts, chunks }));
      setAnalyticsDates(metadata?.analytics?.dates);

      // Step 3: Create conversation session (reused for follow-ups)
      sessionRef.current = await createConversationSession({
        provider: modelObj.provider,
        model: modelObj.model,
        temperature,
        systemContext: context,
      });

      // Step 4: Send first message via session (wrapped for RAG)
      const wrappedQuery = wrapQueryForRag(query);
      let usage = null;
      let firstTokenTime = null;
      for await (const event of sessionRef.current.sendMessage(wrappedQuery)) {
        if (event.type === "data") {
          // Track first token time
          if (firstTokenTime === null) {
            firstTokenTime = new Date() - start;
          }
          // Stream answer into the last conversation entry
          setConversation((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0) {
              updated[lastIdx] = {
                ...updated[lastIdx],
                answer: (updated[lastIdx].answer ?? "") + event.message,
              };
            }
            return updated;
          });
        } else if (event.type === "usage") {
          usage = event.message;
        }
      }

      const endTime = new Date();

      // Finalize the conversation entry with rich queryInfo
      const entryQueryInfo = {
        usage: usage
          ? {
              input: { tokens: usage.inputTokens, cachedTokens: 0 },
              output: { tokens: usage.outputTokens, reasoningTokens: 0 },
              // Add conversation-specific fields
              totalTokens: usage.totalTokens,
              available: usage.available,
              limit: usage.limit,
            }
          : null,
        elapsed: {
          ...metadata?.elapsed,
          tokensFirst: firstTokenTime,
          tokensLast: endTime - start,
        },
        turnNumber: usage?.turnNumber ?? 1,
        internal: metadata?.internal,
        model: modelObj.model,
        provider: modelObj.provider,
        chunks: {
          numChunks: chunks.length,
          similarityMin: metadata?.chunks?.similarity?.min,
          similarityMax: metadata?.chunks?.similarity?.max,
          similarityAvg: metadata?.chunks?.similarity?.avg,
        },
      };
      updateLastEntry({ queryInfo: entryQueryInfo, isLoading: false });
    } catch (respErr) {
      console.error(respErr); // eslint-disable-line no-undef
      setErr(respErr);
      updateLastEntry({ isLoading: false });
      return;
    } finally {
      setIsFetching(false);
    }
  };

  // Execute a follow-up query using existing conversation session
  // Session is created in executeChatQuery and reused here
  const executeAskMore = async (query) => {
    const start = new Date();
    setQueryValue("");
    setIsFetching(true);
    setErr(null);

    // Add new entry (loading state)
    setConversation((prev) => [
      ...prev,
      { query, answer: null, queryInfo: null, isLoading: true },
    ]);

    try {
      if (!sessionRef.current) {
        throw new Error(
          "No conversation session available. Please start a new conversation.",
        );
      }

      let usage = null;
      let firstTokenTime = null;
      // Follow-up queries don't need the RAG wrapper - just send raw query
      for await (const event of sessionRef.current.sendMessage(query)) {
        if (event.type === "data") {
          // Track first token time
          if (firstTokenTime === null) {
            firstTokenTime = new Date() - start;
          }
          // Stream answer into the last conversation entry
          setConversation((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0) {
              updated[lastIdx] = {
                ...updated[lastIdx],
                answer: (updated[lastIdx].answer ?? "") + event.message,
              };
            }
            return updated;
          });
        } else if (event.type === "usage") {
          usage = event.message;
        }
      }

      const endTime = new Date();
      const duration = endTime - start;

      // Finalize entry with rich queryInfo
      const entryQueryInfo = {
        usage: usage
          ? {
              input: { tokens: usage.inputTokens, cachedTokens: 0 },
              output: { tokens: usage.outputTokens, reasoningTokens: 0 },
              // Add conversation-specific fields
              totalTokens: usage.totalTokens,
              available: usage.available,
              limit: usage.limit,
            }
          : null,
        elapsed: {
          tokensFirst: firstTokenTime,
          tokensLast: duration,
        },
        turnNumber: usage?.turnNumber ?? null,
        internal: null,
        model: modelObj.model,
        provider: modelObj.provider,
        chunks: null,
      };
      updateLastEntry({ queryInfo: entryQueryInfo, isLoading: false });
    } catch (respErr) {
      console.error(respErr); // eslint-disable-line no-undef
      if (respErr instanceof ConversationLimitError) {
        setErr(new Error(respErr.message));
      } else {
        setErr(respErr);
      }
      updateLastEntry({ isLoading: false });
    } finally {
      setIsFetching(false);
    }
  };

  // Effect to execute pending query once model is loaded, or handle load error
  useEffect(() => {
    if (!isLoadingModelForChat) return;

    if (isModelLoaded && pendingQueryRef.current) {
      setIsLoadingModelForChat(false);
      const { queryParams, shouldContinue } = pendingQueryRef.current;
      pendingQueryRef.current = null;
      if (shouldContinue) {
        executeAskMore(queryParams.query);
      } else {
        executeChatQuery(queryParams);
      }
    } else if (modelStatus === "error") {
      // Keep isLoadingModelForChat true so LoadingButton stays visible
      pendingQueryRef.current = null;
      setErr(getError(modelResourceId));
    }
  }, [isModelLoaded, isLoadingModelForChat, modelStatus, modelResourceId]);

  // Handle form submission
  // Behavior depends on conversation state and whether conversations are enabled
  const handleSubmit = () => {
    // Get the query from the form
    const queryEl = document.getElementById("query"); // eslint-disable-line no-undef
    const query = queryEl?.value?.trim();
    if (!query) {
      return;
    }

    // Infer other input parameters
    const postType = selectedPostTypes.map(({ value }) => value);
    const categoryPrimary = selectedCategoryPrimary.map(({ value }) => value);
    const queryParams = { query, postType, categoryPrimary };

    // Should we continue the existing conversation or start fresh?
    const shouldContinue = conversationsEnabled && isConversationActive;

    // If model not loaded, trigger loading and wait
    if (!isModelLoaded) {
      pendingQueryRef.current = { queryParams, shouldContinue };
      setIsLoadingModelForChat(true);
      startLoading(modelResourceId);
      return;
    }

    // Model is loaded, proceed
    if (shouldContinue) {
      executeAskMore(query);
    } else {
      executeChatQuery(queryParams);
    }
  };

  // Handle reset button - clears conversation and unlocks form inputs
  const handleReset = () => {
    resetForNewConversation();
  };

  const placeholder = isConversationActive
    ? conversationsEnabled
      ? "Ask a follow-up question..."
      : "Ask a new question..."
    : "Ask anything";

  return html`
    <${Page} name="Chat">
      <p>
        Use fancy AI to generate answers / text from our blogs / case
        studies / services. You can filter the content we use
        with the form inputs below (dates, categories, etc.).
        ${" "}
        ${isDeveloperMode && searchData && html`<${JsonDataLink} data=${searchData} />`}
        <${DownloadPostsCsv} posts=${posts} />
      </p>

      <${DescriptionButton} />
      <${SuggestedQueries} ...${{ suggestions: SUGGESTIONS, isFetching }} />
      ${posts && html`<${PostsFound} ...${{ posts, analyticsDates }} />`}

      ${err && html`<${Alert} type="error" err=${err}>${err.toString()}</${Alert}>`}

      ${
        isLoadingModelForChat &&
        html`
        <${LoadingButton} resourceId=${modelResourceId} label=${getModelCfg(modelObj).modelShortName}>
          Loading model <strong>${getModelCfg(modelObj).modelShortName}</strong>
        </${LoadingButton}>
      `
      }

      ${conversation.map(
        (entry, idx) => html`
          <div
            key=${`conversation-entry-${idx}`}
            className="conversation-entry"
          >
            <${QueryDisplay} query=${entry.query} />
            ${entry.isLoading && !entry.answer && html`<${LoadingBubble} />`}
            ${entry.answer &&
            html`<${Answer}
              answer=${entry.answer}
              queryInfo=${entry.queryInfo}
            />`}
          </div>
        `,
      )}

      <${ChatInputForm}
        isFetching=${isFetching}
        onSubmit=${handleSubmit}
        onReset=${handleReset}
        hasCompletions=${hasCompletions}
      >
        <${QueryField} placeholder=${placeholder} />
        <${PostTypeSelectDropdown}
          selected=${selectedPostTypes}
          setSelected=${setSelectedPostTypes}
          disabled=${formInputsLocked}
        />
        <${PostCategoryPrimarySelectDropdown}
          selected=${selectedCategoryPrimary}
          setSelected=${setSelectedCategoryPrimary}
          disabled=${formInputsLocked}
        />
        <${PostMinDateDropdown}
          value=${minDate}
          onChange=${setMinDate}
          disabled=${formInputsLocked}
        />
        <${ModelChatSelectDropdown}
          selected=${modelObj}
          setSelected=${setModelObj}
          providers=${providers}
          disabled=${formInputsLocked}
        />
        <${TemperatureDropdown}
          hidden=${!isDeveloperMode}
          value=${temperature}
          onChange=${setTemperature}
          disabled=${formInputsLocked}
        />
      </${ChatInputForm}>
    </${Page}>
  `;
};

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
} from "../../config.js";
import { chat } from "../data/index.js";

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
  // TODO(CONVO): Track conversation token usage
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
  const isConversationActive = conversation.length > 0;
  const hasCompletions = conversation.some((entry) => entry.answer);

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

  // Reset all outputs for a new conversation
  const resetForNewConversation = () => {
    setQueryValue("");
    setConversation([]);
    setPosts(null);
    setSearchData(null);
    setAnalyticsDates({ start: null, end: null });
    setErr(null);
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
  const executeChatQuery = async (queryParams) => {
    const { query, postType, categoryPrimary } = queryParams;

    // Reset for new conversation and add the first entry
    resetForNewConversation();
    setConversation([
      { query, answer: null, queryInfo: null, isLoading: true },
    ]);
    setIsFetching(true);

    // Do the query.
    try {
      let chunks = [];
      let fetchedPosts = [];
      let metadata = null;
      let usage = null;
      for await (let part of chat({
        query,
        postType,
        minDate,
        categoryPrimary,
        withContent: false,
        model: modelObj.model,
        provider: modelObj.provider,
        temperature,
      })) {
        if (part.type === "chunks") {
          chunks.push(...part.message);
        } else if (part.type === "posts") {
          fetchedPosts = part.message;
        } else if (part.type === "metadata") {
          metadata = part.message;
        } else if (part.type === "usage") {
          usage = part.message;
        } else if (part.type === "data") {
          // Stream answer into the last conversation entry
          // Must use functional update to get current state (not stale closure)
          setConversation((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0) {
              updated[lastIdx] = {
                ...updated[lastIdx],
                answer: (updated[lastIdx].answer ?? "") + part.message,
              };
            }
            return updated;
          });
        }
      }

      // Set RAG context (persists for conversation)
      setSearchData({ posts: fetchedPosts, chunks, metadata });
      setPosts(searchResultsToPosts({ posts: fetchedPosts, chunks }));
      setAnalyticsDates(metadata?.analytics?.dates);

      // Finalize the conversation entry with queryInfo
      const entryQueryInfo = {
        usage,
        elapsed: metadata?.elapsed,
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

  // Execute an "Ask More" query (echo response for now)
  const executeAskMore = (query) => {
    setQueryValue("");

    // Add new entry with echo response
    const echoAnswer = `ECHO: ${query}`;
    const echoQueryInfo = {
      model: modelObj.model,
      provider: modelObj.provider,
      elapsed: null,
      usage: null,
      chunks: null,
    };

    setConversation((prev) => [
      ...prev,
      { query, answer: echoAnswer, queryInfo: echoQueryInfo, isLoading: false },
    ]);
  };

  // Effect to execute pending query once model is loaded, or handle load error
  useEffect(() => {
    if (!isLoadingModelForChat) return;

    if (isModelLoaded && pendingQueryRef.current) {
      setIsLoadingModelForChat(false);
      const { queryParams, mode } = pendingQueryRef.current;
      pendingQueryRef.current = null;
      if (mode === "more") {
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

  // Handle form submission with mode ("new" or "more")
  const handleModeSubmit = (mode) => {
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

    // If model not loaded, trigger loading and wait
    if (!isModelLoaded) {
      pendingQueryRef.current = { queryParams, mode };
      setIsLoadingModelForChat(true);
      if (mode === "new") {
        resetForNewConversation();
      }
      startLoading(modelResourceId);
      return;
    }

    // Model is loaded, proceed based on mode
    if (mode === "more") {
      executeAskMore(query);
    } else {
      executeChatQuery(queryParams);
    }
  };

  const placeholder = isConversationActive
    ? "Ask a follow-up question..."
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
        onModeSubmit=${handleModeSubmit}
        hasCompletions=${hasCompletions}
      >
        <${QueryField} placeholder=${placeholder} />
        <${PostTypeSelectDropdown}
          selected=${selectedPostTypes}
          setSelected=${setSelectedPostTypes}
          disabled=${isConversationActive}
        />
        <${PostCategoryPrimarySelectDropdown}
          selected=${selectedCategoryPrimary}
          setSelected=${setSelectedCategoryPrimary}
          disabled=${isConversationActive}
        />
        <${PostMinDateDropdown}
          value=${minDate}
          onChange=${setMinDate}
          disabled=${isConversationActive}
        />
        <${ModelChatSelectDropdown}
          selected=${modelObj}
          setSelected=${setModelObj}
          providers=${providers}
          disabled=${isConversationActive}
        />
        <${TemperatureDropdown}
          hidden=${!isDeveloperMode}
          value=${temperature}
          onChange=${setTemperature}
          disabled=${isConversationActive}
        />
      </${ChatInputForm}>
    </${Page}>
  `;
};

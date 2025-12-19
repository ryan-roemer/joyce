import { useState, useEffect, useRef, Fragment } from "react";
import { Link } from "react-router";

import { html, getElements, getQuerySetter } from "../util/html.js";
import { Page } from "../components/page.js";
import {
  ModelChatSelectDropdown,
  TemperatureDropdown,
  PostMinDateDropdown,
  PostTypeSelectDropdown,
  PostCategoryPrimarySelectDropdown,
  QueryField,
  ChatInputForm,
  ApiSelectDropdown,
} from "../components/forms.js";
import { Answer } from "../components/answer.js";
import { ConversationThread } from "../components/conversation-thread.js";
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
  DEFAULT_API,
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

// TODO(CHAT): UPDATE FOR WEB-LLM!!!
const DescriptionButton = () => {
  const [settings] = useSettings();
  const { isDeveloperMode, featureOpenAIToolEnabled } = settings;

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
          <i className="iconoir-sparks"></i> <strong>Model</strong>: Choose the AI language model that will generate the responses, with different models offering varying speed and quality trade-offs.
        </li>
        ${
          /* TODO(LOCAL): Remove */
          isDeveloperMode &&
          html`
          <${Fragment}>
            <li>
              <i className="iconoir-database"></i> <strong>Data</strong>: Choose the data source for the
              getting post information to pass as context to LLM queries.
              <ul>
                <li><em>Postgres</em>: (Default) Query files from our PostgreSQL database with pgvector extension enabled hosted on Neon.</li>
                <li><em>OpenAI Search</em>: Query files from our OpenAI Vector/File Store via the <a href="https://platform.openai.com/docs/api-reference/vector_stores/search">vector store search</a> API.</li>
                ${featureOpenAIToolEnabled && html`<li><em>OpenAI Tool</em>: Enable a <a href="https://platform.openai.com/docs/guides/tools-file-search">vector store search tool</a> within the Responses API backed by the same OpenAI Vector/File Store.</li>`}
              </ul>
            </li>
            <li>
              <i className="iconoir-cloud-sync"></i> <strong>API</strong>: Choose the upstream API to use.
              <ul>
                <li><em>Chat</em>: (Default) OpenAI's <a href="https://platform.openai.com/docs/api-reference/chat">Chat</a> API for conversational completions. Most other AI providers implement this API.</li>
                <li><em>Responses</em>: OpenAI's newer <a href="https://platform.openai.com/docs/api-reference/responses">Responses</a> API for advanced retrieval-augmented generation (RAG) with citations and file search. Only some other AI providers implement this API.</li>
              </ul>
            </li>
            <li>
              <i className="iconoir-temperature-high"></i> <strong>Temperature</strong>: Control the creativity and randomness of AI responses, from 0 (more focused and deterministic) to 1 (more creative and varied).
            </li>
          </${Fragment}>
        `
        }
      </ul>
    </${Description}>
  `;
};

export const Chat = () => {
  // Woah, that's a lot of state.
  const [isFetching, setIsFetching] = useState(false);
  const [posts, setPosts] = useState(null);
  const [searchData, setSearchData] = useState(null);
  const [selectedPostTypes, setSelectedPostTypes] = useState([]);
  const [selectedCategoryPrimary, setSelectedCategoryPrimary] = useState([]);
  const [completions, setCompletions] = useState(null);
  const [completionsCount, setCompletionsCount] = useState(0);
  const [queryInfo, setQueryInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [analyticsDates, setAnalyticsDates] = useState({
    start: null,
    end: null,
  });
  const [modelObj, setModelObj] = useState(DEFAULT_CHAT_MODEL);
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [minDate, setMinDate] = useState("");
  const [currentQuery, setCurrentQuery] = useState(null);
  const [api, setApi] = useState(DEFAULT_API);

  // Conversation history for multi-turn chat
  // Each entry: { role: "user" | "assistant", content: string, queryInfo?: object }
  const [conversationHistory, setConversationHistory] = useState([]);
  const [conversationId, setConversationId] = useState(null);

  // Session token info for Chrome AI (tracks remaining context capacity)
  // { used: number, remaining: number, total: number, nearLimit: boolean }
  const [sessionInfo, setSessionInfo] = useState(null);

  // Compaction info for Web-LLM (tracks when old context was removed)
  // { compacted: boolean, removedTurns: number, remainingTurns: number }
  const [compactionInfo, setCompactionInfo] = useState(null);

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

  // Reset outputs for a new query. If isNewConversation is true, clears conversation history.
  const resetOutputs = (
    query,
    { setFetching = true, isNewConversation = false } = {},
  ) => {
    setQueryValue("");
    if (setFetching) setIsFetching(true);
    setPosts(null);
    setSearchData(null);
    setQueryInfo(null);
    setCompletions(null);
    setErr(null);
    setCurrentQuery(query);

    if (isNewConversation) {
      setConversationHistory([]);
      setConversationId(null);
      setSessionInfo(null);
      setCompactionInfo(null);
    }
  };

  // Start a new conversation (clears history)
  const startNewConversation = () => {
    setConversationHistory([]);
    setConversationId(null);
    setSessionInfo(null);
    setCompactionInfo(null);
    setPosts(null);
    setSearchData(null);
    setQueryInfo(null);
    setCompletions(null);
    setErr(null);
    setCurrentQuery(null);
    setCompletionsCount(0);
  };

  // Execute the actual chat query
  const executeChatQuery = async (
    queryParams,
    { isNewConversation = false } = {},
  ) => {
    const { query, postType, categoryPrimary } = queryParams;

    // Get ready for new query output for the page.
    resetOutputs(query, { isNewConversation });

    // Build previousMessages from conversation history for the API
    const previousMessages = isNewConversation
      ? []
      : conversationHistory.map(({ role, content }) => ({
          role,
          content,
        }));

    // Add user message to conversation history immediately
    const userMessage = { role: "user", content: query };
    setConversationHistory((prev) =>
      isNewConversation ? [userMessage] : [...prev, userMessage],
    );

    // Generate a new conversation ID if needed
    const currentConversationId = isNewConversation
      ? Date.now().toString()
      : conversationId || Date.now().toString();

    // Update state with the conversation ID
    if (!conversationId || isNewConversation) {
      setConversationId(currentConversationId);
    }

    // Do the query.
    try {
      let chunks = [];
      let posts = [];
      let metadata = null;
      let usage = null;
      let fullResponse = "";

      for await (let part of chat({
        api,
        query,
        postType,
        minDate,
        categoryPrimary,
        withContent: false,
        model: modelObj.model,
        provider: modelObj.provider,
        temperature,
        previousMessages,
        conversationId: currentConversationId,
        isNewConversation,
      })) {
        if (part.type === "chunks") {
          chunks.push(...part.message);
        } else if (part.type === "posts") {
          posts = part.message;
        } else if (part.type === "metadata") {
          metadata = part.message;
        } else if (part.type === "usage") {
          usage = part.message;
        } else if (part.type === "data") {
          fullResponse += part.message;
          setCompletions((prev) => (prev ?? "") + part.message);
        } else if (part.type === "sessionInfo") {
          setSessionInfo(part.message);
        } else if (part.type === "compactionInfo") {
          setCompactionInfo(part.message);
        }
      }

      // Build query info object
      const newQueryInfo = {
        usage,
        elapsed: metadata?.elapsed,
        internal: metadata?.internal,
        model: modelObj.model,
        provider: modelObj.provider,
        providerApi: api,
        chunks: {
          numChunks: chunks.length,
          similarityMin: metadata?.chunks?.similarity?.min,
          similarityMax: metadata?.chunks?.similarity?.max,
          similarityAvg: metadata?.chunks?.similarity?.avg,
        },
      };

      // Add assistant response to conversation history
      setConversationHistory((prev) => [
        ...prev,
        { role: "assistant", content: fullResponse, queryInfo: newQueryInfo },
      ]);

      // Set state
      setSearchData({ posts, chunks, metadata });
      setPosts(searchResultsToPosts({ posts, chunks }));
      setAnalyticsDates(metadata?.analytics?.dates);
      setQueryInfo(newQueryInfo);
      setCompletionsCount((prev) => prev + 1);
    } catch (respErr) {
      console.error(respErr); // eslint-disable-line no-undef
      setErr(respErr);
      // Remove the user message we added since the query failed
      setConversationHistory((prev) => prev.slice(0, -1));
      return;
    } finally {
      setIsFetching(false);
    }
  };

  // Effect to execute pending query once model is loaded, or handle load error
  useEffect(() => {
    if (!isLoadingModelForChat) return;

    if (isModelLoaded && pendingQueryRef.current) {
      setIsLoadingModelForChat(false);
      const { isNewConversation, ...queryParams } = pendingQueryRef.current;
      pendingQueryRef.current = null;
      executeChatQuery(queryParams, {
        isNewConversation: isNewConversation ?? false,
      });
    } else if (modelStatus === "error") {
      // Keep isLoadingModelForChat true so LoadingButton stays visible
      pendingQueryRef.current = null;
      setErr(getError(modelResourceId));
    }
  }, [isModelLoaded, isLoadingModelForChat, modelStatus, modelResourceId]);

  // Handle form submit - can be called with isNewConversation flag
  const handleSubmit = async (event, { isNewConversation = false } = {}) => {
    event.preventDefault();
    const { query } = getElements(event);
    if (!query) {
      return;
    }

    // Infer other input parameters.
    const postType = selectedPostTypes.map(({ value }) => value);
    const categoryPrimary = selectedCategoryPrimary.map(({ value }) => value);
    const queryParams = { query, postType, categoryPrimary };

    // If model not loaded, trigger loading and wait
    if (!isModelLoaded) {
      pendingQueryRef.current = { ...queryParams, isNewConversation };
      setIsLoadingModelForChat(true);
      resetOutputs(query, { setFetching: false, isNewConversation });
      startLoading(modelResourceId);
      return;
    }

    // Model is loaded, proceed directly
    executeChatQuery(queryParams, { isNewConversation });
  };

  // Convenience handlers for the two submit modes
  const handleContinue = (event) =>
    handleSubmit(event, { isNewConversation: false });

  // Handle "New Chat" button click - find the form from the button
  const handleNewChat = (event) => {
    event.preventDefault();
    const form = event.target.closest("form");
    if (!form) return;
    // Create a synthetic event with the form as target and currentTarget
    const syntheticEvent = {
      preventDefault: () => {},
      target: form,
      currentTarget: form,
    };
    handleSubmit(syntheticEvent, { isNewConversation: true });
  };

  // Determine if we have an active conversation
  const hasConversation = conversationHistory.length > 0;

  // Check if we're near the session token limit (Chrome AI only)
  const isNearTokenLimit = sessionInfo?.nearLimit ?? false;

  // Button configuration based on conversation state
  const placeholder = hasConversation
    ? isNearTokenLimit
      ? "Context nearly full - consider starting a new chat"
      : "Continue the conversation..."
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
        isNearTokenLimit &&
        !isFetching &&
        html`
          <div className="session-warning">
            <i className="iconoir-warning-triangle"></i>
            <span>
              Context is
              ${Math.round((sessionInfo.used / sessionInfo.total) * 100)}% full.
              Consider starting a <strong>New</strong> conversation for best
              results.
            </span>
          </div>
        `
      }

      ${
        isLoadingModelForChat &&
        html`
        <${LoadingButton} resourceId=${modelResourceId} label=${getModelCfg(modelObj).modelShortName}>
          Loading model <strong>${getModelCfg(modelObj).modelShortName}</strong>
        </${LoadingButton}>
      `
      }

      ${"" /* Show conversation history - previous complete turns */}
      ${"" /* When not streaming: show all except the last assistant (shown via Answer) */}
      ${"" /* When streaming: show all except the current user query (shown via QueryDisplay) */}
      ${
        hasConversation &&
        conversationHistory.length > 1 &&
        html`
          <${ConversationThread} history=${conversationHistory.slice(0, -1)} />
        `
      }

      ${"" /* Show current query - only while fetching to avoid duplicate with history */}
      ${isFetching && currentQuery && html`<${QueryDisplay} query=${currentQuery} />`}
      ${isFetching && !completions && !isLoadingModelForChat && html`<${LoadingBubble} />`}
      ${
        completions &&
        html`<${Answer} answer=${completions} queryInfo=${queryInfo} />`
      }

      ${
        isDeveloperMode &&
        sessionInfo &&
        !isFetching &&
        html`
          <div className="session-token-info">
            <i className="iconoir-data-transfer-both"></i>
            <span>
              Session: ${sessionInfo.used.toLocaleString()} /
              ${sessionInfo.total.toLocaleString()} tokens
              (${sessionInfo.remaining.toLocaleString()} remaining)
            </span>
          </div>
        `
      }

      ${
        isDeveloperMode &&
        compactionInfo?.compacted &&
        !isFetching &&
        html`
          <div className="compaction-info">
            <i className="iconoir-compress"></i>
            <span>
              Context compacted: removed ${compactionInfo.removedTurns} older
              turn${compactionInfo.removedTurns !== 1 ? "s" : ""}
              (${compactionInfo.remainingTurns}
              turn${compactionInfo.remainingTurns !== 1 ? "s" : ""} remaining)
            </span>
          </div>
        `
      }

      <${ChatInputForm}
        isFetching=${isFetching}
        handleSubmit=${handleContinue}
        handleNewChat=${hasConversation ? handleNewChat : null}
        submitName=${hasConversation ? "Continue" : "Ask"}
        hasConversation=${hasConversation}
      >
        <${QueryField} placeholder=${placeholder} />
        <${PostTypeSelectDropdown}
          selected=${selectedPostTypes}
          setSelected=${setSelectedPostTypes}
        />
        <${PostCategoryPrimarySelectDropdown}
          selected=${selectedCategoryPrimary}
          setSelected=${setSelectedCategoryPrimary}
        />
        <${PostMinDateDropdown} value=${minDate} onChange=${setMinDate} />
        <${ModelChatSelectDropdown}
          selected=${modelObj}
          setSelected=${setModelObj}
          providers=${providers}
        />
        <${ApiSelectDropdown}
          hidden=${!isDeveloperMode}
          selected=${api}
          setSelected=${setApi}
        />
        <${TemperatureDropdown} hidden=${!isDeveloperMode} value=${temperature} onChange=${setTemperature} />
      </${ChatInputForm}>
    </${Page}>
  `;
};

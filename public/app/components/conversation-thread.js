import { Fragment } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { html } from "../util/html.js";
import { useSettings } from "../hooks/use-settings.js";
import { ALL_PROVIDERS, getModelCfg } from "../../config.js";
import { formatInt, formatFloat, formatElapsed } from "../../shared-util.js";

/**
 * Display a single message in the conversation thread.
 * User messages are displayed on the right, assistant messages on the left.
 */
const ConversationMessage = ({ message, isDeveloperMode }) => {
  const { role, content, queryInfo } = message;
  const isUser = role === "user";

  if (isUser) {
    // User message - styled like QueryDisplay
    return html`
      <div className="conversation-message conversation-message-user">
        <div className="conversation-message-content query-display">
          ${content}
        </div>
      </div>
    `;
  }

  // Assistant message - styled like Answer
  const renderedHtml = marked.parse(content, { breaks: true, gfm: true });
  const sanitizedHtml = DOMPurify.sanitize(renderedHtml);

  return html`
    <div className="conversation-message conversation-message-assistant">
      <div className="conversation-message-content answer">
        <div
          className="markdown-body"
          dangerouslySetInnerHTML=${{ __html: sanitizedHtml }}
        />
      </div>
      ${isDeveloperMode &&
      queryInfo &&
      html`<${QueryInfoCompact} ...${queryInfo} />`}
    </div>
  `;
};

/**
 * Compact query info for conversation history (collapsed by default).
 */
const QueryInfoCompact = ({ elapsed, usage, model, provider, chunks } = {}) => {
  if (!elapsed && !usage && !model && !chunks) return null;

  const totalElapsed = elapsed?.tokensLast
    ? formatElapsed(elapsed.tokensLast)
    : null;

  const modelCfg = getModelCfg({ provider, model });
  const hasCost = modelCfg?.pricing && usage?.input?.cost != null;
  const totalCost = hasCost
    ? (usage.input.cost + usage.output.cost).toFixed(2)
    : null;

  return html`
    <details className="query-info query-info-compact">
      <summary>
        <em>
          ${model && html`${model}${(totalElapsed || usage) && ", "}`}
          ${totalElapsed && html`${totalElapsed}${hasCost && ", "}`}
          ${hasCost && html`$${totalCost}`}
        </em>
      </summary>
      <div>
        ${usage &&
        html`
          <span>
            In: ${formatInt(usage.input?.tokens || 0)} / Out:
            ${formatInt(usage.output?.tokens || 0)} tokens
          </span>
        `}
        ${chunks &&
        html`
          <span style=${{ marginLeft: "8px" }}>
            ${formatInt(chunks.numChunks)} chunks
          </span>
        `}
      </div>
    </details>
  `;
};

/**
 * Display a thread of conversation messages.
 * @param {Object} props
 * @param {Array<{role: string, content: string, queryInfo?: object}>} props.history - Conversation history
 */
export const ConversationThread = ({ history = [] }) => {
  const [settings] = useSettings();
  const { isDeveloperMode } = settings;

  if (history.length === 0) {
    return null;
  }

  return html`
    <div className="conversation-thread">
      ${history.map(
        (message, index) => html`
          <${ConversationMessage}
            key=${`msg-${index}`}
            message=${message}
            isDeveloperMode=${isDeveloperMode}
          />
        `,
      )}
    </div>
  `;
};

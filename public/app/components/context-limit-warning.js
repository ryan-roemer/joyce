import { html } from "../util/html.js";
import { Alert } from "./alert.js";

/**
 * Warning displayed when a response was truncated due to context limit.
 * Shows when finishReason === "length", indicating the model hit its token limit.
 *
 * @param {Object} props
 * @param {string} props.finishReason - The finish reason from the model response
 * @param {Function} props.onNewConversation - Callback to start a new conversation
 * @returns {Object|null} HTM element or null
 */
export const ContextLimitWarning = ({ finishReason, onNewConversation }) => {
  // Only show warning when finish reason indicates context limit was hit
  if (finishReason !== "length") {
    return null;
  }

  return html`
    <div className="context-limit-warning-container">
      <${Alert} type="warning">
        <div className="context-limit-warning">
          <div className="context-limit-warning-content">
            <i className="iconoir-warning-triangle"></i>
            <div>
              <strong>Context limit reached</strong>
              <p>
                The response may have been cut short because the conversation exceeded the
                model's context window. Start a new conversation for best results.
              </p>
            </div>
          </div>
          ${
            onNewConversation &&
            html`
              <button className="pure-button" onClick=${onNewConversation}>
                <i className="iconoir-refresh-double"></i>
                ${" "}New Conversation
              </button>
            `
          }
        </div>
      </${Alert}>
    </div>
  `;
};

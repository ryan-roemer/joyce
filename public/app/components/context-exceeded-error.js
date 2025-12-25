import { html } from "../util/html.js";
import { Alert } from "./alert.js";

/**
 * Check if an error is a context window size exceeded error.
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error is a context exceeded error
 */
export const isContextExceededError = (error) => {
  if (!error) return false;
  const errorStr = error.name || error.message || error.toString();
  return errorStr.includes("ContextWindowSizeExceeded");
};

/**
 * Error displayed when the prompt exceeds the model's context window.
 * Shows when web-llm throws ContextWindowSizeExceededError before streaming starts.
 *
 * @param {Object} props
 * @param {Error} props.error - The context exceeded error
 * @param {Function} props.onNewConversation - Callback to start a new conversation
 * @returns {Object|null} HTM element or null
 */
export const ContextExceededError = ({ error, onNewConversation }) => {
  // Only show if error is a context exceeded error
  if (!isContextExceededError(error)) {
    return null;
  }

  return html`
    <div className="context-exceeded-error-container">
      <${Alert} type="error">
        <div className="context-exceeded-error">
          <div className="context-exceeded-error-content">
            <i className="iconoir-warning-circle"></i>
            <div>
              <strong>Context window exceeded</strong>
              <p>
                The conversation is too long for this model's context window.
                Start a new conversation to continue.
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

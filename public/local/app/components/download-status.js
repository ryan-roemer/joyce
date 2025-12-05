import { html } from "../../../app/util/html.js";
import { useDownloads } from "../context/downloads.js";

/**
 * Component for displaying download status and initiating downloads
 * @param {Object} props
 * @param {string} props.resourceId - The resource identifier
 * @param {string} props.label - Display label for the resource
 */
export const DownloadStatus = ({ resourceId, label }) => {
  const { getStatus, getError, startDownload } = useDownloads();
  const status = getStatus(resourceId);
  const error = getError(resourceId);

  const handleStartDownload = () => {
    startDownload(resourceId);
  };

  const getStatusText = () => {
    switch (status) {
      case "not_loaded":
        return "Not loaded";
      case "loading":
        return "Loading...";
      case "loaded":
        return "Loaded";
      case "error":
        return "Error";
      default:
        return "Unknown";
    }
  };

  const getStatusClass = () => {
    switch (status) {
      case "not_loaded":
        return "download-status-not-loaded";
      case "loading":
        return "download-status-loading";
      case "loaded":
        return "download-status-loaded";
      case "error":
        return "download-status-error";
      default:
        return "";
    }
  };

  return html`
    <div className=${`download-status ${getStatusClass()}`}>
      <div className="download-status-label">${label}</div>
      <div className="download-status-info">
        <span className="download-status-text">${getStatusText()}</span>
        ${status === "not_loaded" &&
        html`
          <button
            className="pure-button pure-button-small"
            onClick=${handleStartDownload}
          >
            Load
          </button>
        `}
        ${status === "loading" &&
        html`<span className="download-status-spinner">⏳</span>`}
        ${status === "loaded" &&
        html`<span className="download-status-check">✓</span>`}
        ${status === "error" &&
        error &&
        html`
          <span className="download-status-error-message">
            ${error.message || error.toString()}
          </span>
        `}
      </div>
    </div>
  `;
};

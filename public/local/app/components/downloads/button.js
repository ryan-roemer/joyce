import { html } from "../../../../app/util/html.js";
import { useDownloads } from "../../context/downloads.js";

/**
 * Component for displaying download status and initiating downloads
 * @param {Object} props
 * @param {string} props.resourceId - The resource identifier
 * @param {string} props.label - Display label for the resource
 * @param {string} props.forceStatus - Optional status to force (for demo purposes)
 */
export const DownloadButton = ({
  resourceId,
  label,
  forceStatus = null,
  children,
}) => {
  const { getStatus, startDownload } = useDownloads();
  const status = forceStatus || getStatus(resourceId);

  const handleStartDownload = () => {
    startDownload(resourceId);
  };

  const getIconClass = () => {
    switch (status) {
      case "not_loaded":
        return "iconoir-circle";
      case "loading":
        return "iconoir-refresh";
      case "loaded":
        return "iconoir-check-circle";
      case "error":
        return "iconoir-warning-circle";
      default:
        return "iconoir-circle";
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
        return "download-status-not-loaded";
    }
  };

  const isClickable = status === "not_loaded" && !forceStatus;

  return html`
    <div className="pure-form pure-form-stacked">
      <div className="pure-control-group download-status-row">
        <label className="download-status-label">${children || label}</label>
        <div className="download-status-icon-container">
          ${isClickable
            ? html`
                <button
                  className=${`download-status-icon-button ${getStatusClass()}`}
                  onClick=${handleStartDownload}
                  type="button"
                >
                  <i className=${getIconClass()}></i>
                </button>
              `
            : html`
                <span className=${`download-status-icon ${getStatusClass()}`}>
                  <i className=${getIconClass()}></i>
                </span>
              `}
        </div>
      </div>
    </div>
  `;
};

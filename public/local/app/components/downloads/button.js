import { html } from "../../../../app/util/html.js";
import { useDownloads } from "../../context/downloads.js";
import { formatElapsed } from "../../../../app/components/answer.js";

const STATES = {
  not_loaded: {
    icon: "iconoir-circle",
    cls: "download-status-not-loaded",
    title: "Not Loaded",
  },
  loading: {
    icon: "iconoir-refresh",
    cls: "download-status-loading",
    title: "Loading",
  },
  loaded: {
    icon: "iconoir-check-circle",
    cls: "download-status-loaded",
    title: "Loaded",
  },
  error: {
    icon: "iconoir-warning-circle",
    cls: "download-status-error",
    title: (err) => `Error${err ? `: ${err}` : ""}`,
  },
};

/**
 * Component for displaying download status and initiating downloads
 * @param {Object} props
 * @param {string} props.resourceId - The resource identifier
 * @param {string} props.label - Display label for the resource
 * @param {string} props.forceStatus - Optional status to force (for demo purposes)
 */
// TODO(CLEANUP): Remove forceStatus prop
export const DownloadButton = ({
  resourceId,
  label,
  forceStatus = null,
  children,
}) => {
  const { getStatus, getError, getElapsed, startDownload } = useDownloads();
  const status = forceStatus || getStatus(resourceId);
  const error = getError(resourceId);
  const elapsed = getElapsed(resourceId);
  const state = STATES[status] || STATES.not_loaded;
  const title =
    typeof state.title === "function" ? state.title(error) : state.title;

  const handleStartDownload = () => {
    startDownload(resourceId);
  };

  const isClickable = status === "not_loaded" && !forceStatus;

  // TODO(CLEANUP): Move elapsed to right side in italics.
  return html`
    <div className="pure-form pure-form-stacked">
      <div className="pure-control-group download-status-row">
        <label className="download-status-label">
          ${children || label}
          ${elapsed
            ? html` <span className="download-status-elapsed" key="elapsed"
                >(${formatElapsed(elapsed)})</span
              >`
            : null}
        </label>
        <div className="download-status-icon-container">
          ${isClickable
            ? html`
                <button
                  className=${`download-status-icon-button ${state.cls}`}
                  onClick=${handleStartDownload}
                  type="button"
                  title=${title}
                >
                  <i className=${state.icon}></i>
                </button>
              `
            : html`
                <span
                  className=${`download-status-icon ${state.cls}`}
                  title=${title}
                >
                  <i className=${state.icon}></i>
                </span>
              `}
        </div>
      </div>
    </div>
  `;
};

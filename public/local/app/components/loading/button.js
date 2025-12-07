import { html } from "../../../../app/util/html.js";
import { useLoading } from "../../context/loading.js";
import { formatElapsed } from "../../../../app/components/answer.js";

const STATES = {
  not_loaded: {
    icon: "iconoir-circle",
    cls: "loading-status-not-loaded",
    title: "Not Loaded",
  },
  loading: {
    icon: "iconoir-refresh",
    cls: "loading-status-loading",
    title: "Loading",
  },
  loaded: {
    icon: "iconoir-check-circle",
    cls: "loading-status-loaded",
    title: "Loaded",
  },
  error: {
    icon: "iconoir-warning-circle",
    cls: "loading-status-error",
    title: (err) => `Error${err ? `: ${err}` : ""}`,
  },
};

/**
 * Component for displaying loading status and initiating loads
 * @param {Object} props
 * @param {string} props.resourceId - The resource identifier
 * @param {string} props.label - Display label for the resource
 * @param {string} props.forceStatus - Optional status to force (for demo purposes)
 */
// TODO(CLEANUP): Remove forceStatus prop
export const LoadingButton = ({
  resourceId,
  label,
  forceStatus = null,
  children,
}) => {
  const { getStatus, getError, getElapsed, startLoading } = useLoading();
  const status = forceStatus || getStatus(resourceId);
  const error = getError(resourceId);
  const elapsed = getElapsed(resourceId);
  const state = STATES[status] || STATES.not_loaded;
  const title =
    typeof state.title === "function" ? state.title(error) : state.title;

  const handleStartLoading = () => {
    startLoading(resourceId);
  };

  const isClickable = status === "not_loaded" && !forceStatus;

  // TODO(CLEANUP): Move elapsed to right side in italics.
  // TODO(LOADING): Maybe add label name and description, separated in styles, then elapsed separately.
  return html`
    <div className="pure-form pure-form-stacked">
      <div className="pure-control-group loading-status-row">
        <label className="loading-status-label">
          ${children || label}
          ${elapsed
            ? html` <span className="loading-status-elapsed" key="elapsed"
                >(${formatElapsed(elapsed)})</span
              >`
            : null}
        </label>
        <div className="loading-status-icon-container">
          ${isClickable
            ? html`
                <button
                  className=${`loading-status-icon-button ${state.cls}`}
                  onClick=${handleStartLoading}
                  type="button"
                  title=${title}
                >
                  <i className=${state.icon}></i>
                </button>
              `
            : html`
                <span
                  className=${`loading-status-icon ${state.cls}`}
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

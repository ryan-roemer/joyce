/**
 * Offline status indicator components.
 * Shows whether resources are cached and available for offline use.
 */
import { html } from "../../../app/util/html.js";

/**
 * Status configuration for offline indicators.
 *
 * States:
 * - not_cached: Not available offline (gray)
 * - cached: Available offline, not loaded (blue)
 * - loading: Currently loading (yellow/spinning)
 * - loaded_not_cached: Loaded but not cached (green outline)
 * - loaded_cached: Loaded and cached (solid green)
 * - error: Error state (red)
 */
export const OFFLINE_STATUS_CONFIG = {
  not_cached: {
    icon: "iconoir-cloud-xmark",
    cls: "offline-status-not-cached",
    title: "Not available offline",
    color: "var(--color-gray, #999)",
  },
  cached: {
    icon: "iconoir-cloud-check",
    cls: "offline-status-cached",
    title: "Available offline",
    color: "var(--color-blue, #3498db)",
  },
  loading: {
    icon: "iconoir-cloud-sync",
    cls: "offline-status-loading",
    title: "Loading...",
    color: "var(--color-yellow, #f1c40f)",
  },
  loaded_not_cached: {
    icon: "iconoir-check-circle",
    cls: "offline-status-loaded-not-cached",
    title: "Loaded (requires network on restart)",
    color: "var(--color-green, #2ecc71)",
  },
  loaded_cached: {
    icon: "iconoir-check-circle-solid",
    cls: "offline-status-loaded-cached",
    title: "Loaded and cached (works offline)",
    color: "var(--color-green, #2ecc71)",
  },
  error: {
    icon: "iconoir-warning-circle",
    cls: "offline-status-error",
    title: "Error",
    color: "var(--color-red, #e74c3c)",
  },
};

/**
 * Determine the combined offline status based on loading and cached states.
 * @param {Object} params
 * @param {string} params.loadingStatus - "not_loaded" | "loading" | "loaded" | "error"
 * @param {boolean | null} params.isCached - Whether resource is cached for offline use
 * @returns {string} The combined status key
 */
export const getOfflineStatus = ({ loadingStatus, isCached }) => {
  if (loadingStatus === "error") {
    return "error";
  }
  if (loadingStatus === "loading") {
    return "loading";
  }
  if (loadingStatus === "loaded") {
    return isCached ? "loaded_cached" : "loaded_not_cached";
  }
  // not_loaded
  return isCached ? "cached" : "not_cached";
};

/**
 * Simple offline status icon component.
 * @param {Object} props
 * @param {string} props.status - Status key from OFFLINE_STATUS_CONFIG
 * @param {string} props.size - Icon size (default "16px")
 * @param {boolean} props.showTitle - Whether to show title on hover
 */
export const OfflineStatusIcon = ({
  status = "not_cached",
  size = "16px",
  showTitle = true,
}) => {
  const config =
    OFFLINE_STATUS_CONFIG[status] || OFFLINE_STATUS_CONFIG.not_cached;

  return html`
    <span
      className=${`offline-status-icon ${config.cls}`}
      title=${showTitle ? config.title : undefined}
      style=${{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size,
        color: config.color,
      }}
    >
      <i className=${config.icon}></i>
    </span>
  `;
};

/**
 * Offline status badge with label.
 * @param {Object} props
 * @param {string} props.status - Status key from OFFLINE_STATUS_CONFIG
 * @param {boolean} props.showLabel - Whether to show the text label
 */
export const OfflineStatusBadge = ({
  status = "not_cached",
  showLabel = true,
}) => {
  const config =
    OFFLINE_STATUS_CONFIG[status] || OFFLINE_STATUS_CONFIG.not_cached;

  return html`
    <span
      className=${`offline-status-badge ${config.cls}`}
      style=${{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 6px",
        borderRadius: "4px",
        fontSize: "12px",
        backgroundColor: `${config.color}20`,
        color: config.color,
      }}
    >
      <i className=${config.icon}></i>
      ${showLabel && html`<span>${config.title}</span>`}
    </span>
  `;
};

/**
 * Compact offline indicator (just the cloud icon).
 * Good for use in tables and lists.
 * @param {Object} props
 * @param {boolean} props.isCached - Whether the resource is cached
 * @param {boolean} props.isLoading - Whether the resource is loading
 */
export const OfflineIndicator = ({ isCached = false, isLoading = false }) => {
  let status = "not_cached";
  if (isLoading) {
    status = "loading";
  } else if (isCached) {
    status = "cached";
  }

  return html`<${OfflineStatusIcon} status=${status} size="14px" />`;
};

/**
 * Combined loading + offline status indicator.
 * Shows both the loading state and offline readiness.
 * @param {Object} props
 * @param {string} props.loadingStatus - "not_loaded" | "loading" | "loaded" | "error"
 * @param {boolean | null} props.isCached - Whether resource is cached
 * @param {string} props.size - Icon size
 */
export const CombinedStatusIcon = ({
  loadingStatus = "not_loaded",
  isCached = null,
  size = "16px",
}) => {
  const status = getOfflineStatus({ loadingStatus, isCached });
  return html`<${OfflineStatusIcon} status=${status} size=${size} />`;
};

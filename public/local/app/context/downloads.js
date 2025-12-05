import { createContext, useContext, useState, useEffect } from "react";
import { html } from "../../../app/util/html.js";
import {
  getDownloadStatus,
  subscribeDownloadStatus,
  startDownload as startDownloadApi,
} from "../../data/api.js";

// Create the context with a default value
const DownloadsContext = createContext(null);

/**
 * Provider component that manages download state
 */
export const DownloadsProvider = ({ children }) => {
  const [statuses, setStatuses] = useState(new Map());
  const [errors, setErrors] = useState(new Map());

  // Update status for a resource
  const updateStatus = (resourceId, status, error = null) => {
    setStatuses((prev) => {
      const next = new Map(prev);
      next.set(resourceId, status);
      return next;
    });
    if (error) {
      setErrors((prev) => {
        const next = new Map(prev);
        next.set(resourceId, error);
        return next;
      });
    } else {
      setErrors((prev) => {
        const next = new Map(prev);
        next.delete(resourceId);
        return next;
      });
    }
  };

  // Initialize statuses from API
  useEffect(() => {
    const resourceIds = ["posts_data"];
    resourceIds.forEach((resourceId) => {
      const status = getDownloadStatus(resourceId);
      updateStatus(resourceId, status);
    });
  }, []);

  // Subscribe to status changes
  useEffect(() => {
    const resourceIds = ["posts_data"];
    const unsubscribes = resourceIds.map((resourceId) => {
      return subscribeDownloadStatus(resourceId, (status, error) => {
        updateStatus(resourceId, status, error);
      });
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, []);

  const handleStartDownload = (resourceId) => {
    startDownloadApi(resourceId);
  };

  const value = {
    getStatus: (resourceId) => statuses.get(resourceId) || "not_loaded",
    getError: (resourceId) => errors.get(resourceId) || null,
    startDownload: handleStartDownload,
  };

  return html`
    <${DownloadsContext.Provider} value=${value}>
      ${children}
    </${DownloadsContext.Provider}>
  `;
};

/**
 * Hook to use the downloads context
 */
export const useDownloads = () => {
  const context = useContext(DownloadsContext);
  if (!context) {
    throw new Error("useDownloads must be used within a DownloadsProvider");
  }
  return context;
};

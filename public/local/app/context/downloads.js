import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { html } from "../../../app/util/html.js";
import {
  RESOURCES,
  getDownloadStatus,
  subscribeDownloadStatus,
  startDownload,
} from "../../data/downloads.js";

// Create the context with a default value
const DownloadsContext = createContext(null);

/**
 * Find a resource by its ID
 * @param {string} resourceId
 * @returns {{ id: string, get: () => Promise<any> } | undefined}
 */
const findResourceById = (resourceId) => {
  return Object.values(RESOURCES).find((r) => r.id === resourceId);
};

/**
 * Provider component that manages download state
 */
export const DownloadsProvider = ({ children }) => {
  const [statuses, setStatuses] = useState(new Map());
  const [errors, setErrors] = useState(new Map());
  const [elapsedTimes, setElapsedTimes] = useState(new Map());

  // Update status for a resource
  const updateStatus = useCallback(
    (resourceId, status, { error = null, elapsed = null } = {}) => {
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
      if (elapsed !== null) {
        setElapsedTimes((prev) => {
          const next = new Map(prev);
          next.set(resourceId, elapsed);
          return next;
        });
      }
    },
    [],
  );

  // Initialize statuses from API
  useEffect(() => {
    const resources = Object.values(RESOURCES);
    resources.forEach((resource) => {
      const status = getDownloadStatus(resource.id);
      updateStatus(resource.id, status);
    });
  }, [updateStatus]);

  // Subscribe to status changes
  useEffect(() => {
    const resources = Object.values(RESOURCES);
    const unsubscribes = resources.map((resource) => {
      return subscribeDownloadStatus(
        resource.id,
        (status, { error, elapsed }) => {
          updateStatus(resource.id, status, { error, elapsed });
        },
      );
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [updateStatus]);

  const handleStartDownload = useCallback((resourceId) => {
    const resource = findResourceById(resourceId);
    if (resource) {
      startDownload(resource);
    }
  }, []);

  const value = useMemo(
    () => ({
      getStatus: (resourceId) => statuses.get(resourceId) || "not_loaded",
      getError: (resourceId) => errors.get(resourceId) || null,
      getElapsed: (resourceId) => elapsedTimes.get(resourceId) || null,
      startDownload: handleStartDownload,
    }),
    [statuses, errors, elapsedTimes, handleStartDownload],
  );

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

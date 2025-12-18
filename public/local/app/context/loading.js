/* global document:false */
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
  getLoadingStatus,
  getLoadingProgress,
  getCachedStatus as getCachedStatusFromLoader,
  subscribeLoadingStatus,
  subscribeLoadingProgress,
  subscribeCachedStatus,
  checkCachedStatus,
  startLoading,
  findResourceById,
  registerLlmResource,
} from "../../data/loading.js";
import { getProviderForModel } from "../../../config.js";

// Create the context with a default value
const LoadingContext = createContext(null);

/**
 * Provider component that manages loading state
 */
export const LoadingProvider = ({ children }) => {
  const [statuses, setStatuses] = useState(new Map());
  const [errors, setErrors] = useState(new Map());
  const [elapsedTimes, setElapsedTimes] = useState(new Map());
  const [progressMap, setProgressMap] = useState(new Map());
  const [cachedMap, setCachedMap] = useState(new Map());

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

  // Update progress for a resource
  const updateProgress = useCallback((resourceId, progress) => {
    setProgressMap((prev) => {
      const next = new Map(prev);
      next.set(resourceId, progress);
      return next;
    });
  }, []);

  // Update cached status for a resource
  const updateCached = useCallback((resourceId, isCached) => {
    setCachedMap((prev) => {
      const next = new Map(prev);
      next.set(resourceId, isCached);
      return next;
    });
  }, []);

  // Subscribe to status changes and initialize from current state
  // Note: We subscribe first, then check current status to avoid race conditions
  // where a load completes between checking status and subscribing
  useEffect(() => {
    const resources = Object.values(RESOURCES);
    const unsubscribes = resources.flatMap((resource) => {
      // Subscribe to status changes
      const unsubStatus = subscribeLoadingStatus(
        resource.id,
        (status, { error, elapsed }) => {
          updateStatus(resource.id, status, { error, elapsed });
        },
      );
      // Check current status after subscribing to catch any updates we missed
      const currentStatus = getLoadingStatus(resource.id);
      updateStatus(resource.id, currentStatus);

      // Subscribe to progress changes
      const unsubProgress = subscribeLoadingProgress(
        resource.id,
        (progress) => {
          updateProgress(resource.id, progress);
        },
      );
      // Check current progress after subscribing
      const currentProgress = getLoadingProgress(resource.id);
      if (currentProgress) {
        updateProgress(resource.id, currentProgress);
      }

      // Subscribe to cached status changes
      const unsubCached = subscribeCachedStatus(resource.id, (isCached) => {
        updateCached(resource.id, isCached);
      });
      // Check current cached status
      const currentCached = getCachedStatusFromLoader(resource.id);
      if (currentCached !== null) {
        updateCached(resource.id, currentCached);
      }

      return [unsubStatus, unsubProgress, unsubCached];
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [updateStatus, updateProgress, updateCached]);

  // Refresh cached status on visibility change (when user returns to tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Re-check cached status for all resources
        Object.values(RESOURCES).forEach((resource) => {
          checkCachedStatus(resource.id);
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleStartLoading = useCallback(
    (resourceId) => {
      let resource = findResourceById(resourceId);

      // Auto-register LLM resources if they don't exist
      // Look up the correct provider for the model
      if (!resource && resourceId.startsWith("llm_")) {
        const modelId = resourceId.replace(/^llm_/, "");
        const provider = getProviderForModel(modelId);
        if (provider) {
          registerLlmResource(provider, modelId);
          resource = findResourceById(resourceId);

          // Subscribe to status/progress/cached changes for the newly registered resource
          if (resource) {
            subscribeLoadingStatus(
              resource.id,
              (status, { error, elapsed }) => {
                updateStatus(resource.id, status, { error, elapsed });
              },
            );
            subscribeLoadingProgress(resource.id, (progress) => {
              updateProgress(resource.id, progress);
            });
            subscribeCachedStatus(resource.id, (isCached) => {
              updateCached(resource.id, isCached);
            });
          }
        }
      }

      if (resource) {
        startLoading(resource);
      }
    },
    [updateStatus, updateProgress, updateCached],
  );

  // Function to refresh cached status for a specific resource
  const refreshCachedStatus = useCallback((resourceId) => {
    checkCachedStatus(resourceId);
  }, []);

  const value = useMemo(
    () => ({
      getStatus: (resourceId) => statuses.get(resourceId) || "not_loaded",
      getError: (resourceId) => errors.get(resourceId) || null,
      getElapsed: (resourceId) => elapsedTimes.get(resourceId) ?? null,
      getProgress: (resourceId) => progressMap.get(resourceId) ?? null,
      getCached: (resourceId) => cachedMap.get(resourceId) ?? null,
      startLoading: handleStartLoading,
      refreshCachedStatus,
    }),
    [
      statuses,
      errors,
      elapsedTimes,
      progressMap,
      cachedMap,
      handleStartLoading,
      refreshCachedStatus,
    ],
  );

  return html`
    <${LoadingContext.Provider} value=${value}>
      ${children}
    </${LoadingContext.Provider}>
  `;
};

/**
 * Hook to use the loading context
 */
export const useLoading = () => {
  const context = useContext(LoadingContext);
  if (!context) {
    throw new Error("useLoading must be used within a LoadingProvider");
  }
  return context;
};

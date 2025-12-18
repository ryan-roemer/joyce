/* global navigator:false, MessageChannel:false, setTimeout:false */
/**
 * Service Worker status utilities
 */

/**
 * Get the current Service Worker registration status
 * @returns {Promise<Object>} Status object
 */
export const getServiceWorkerStatus = async () => {
  if (!("serviceWorker" in navigator)) {
    return {
      supported: false,
      registered: false,
      active: false,
      waiting: false,
      controller: false,
    };
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();

    return {
      supported: true,
      registered: !!registration,
      active: !!registration?.active,
      waiting: !!registration?.waiting,
      controller: !!navigator.serviceWorker.controller,
      scope: registration?.scope,
    };
  } catch (err) {
    return {
      supported: true,
      registered: false,
      active: false,
      waiting: false,
      controller: false,
      error: err.message,
    };
  }
};

/**
 * Get cache size from Service Worker
 * @returns {Promise<number | null>} Cache size in bytes or null
 */
export const getCacheSize = async () => {
  if (!navigator.serviceWorker?.controller) {
    return null;
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      if (event.data?.type === "CACHE_SIZE") {
        resolve(event.data.size);
      }
    };

    navigator.serviceWorker.controller.postMessage({ type: "GET_CACHE_SIZE" }, [
      channel.port2,
    ]);

    // Timeout after 5 seconds
    setTimeout(() => resolve(null), 5000);
  });
};

/**
 * Clear Service Worker cache
 * @returns {Promise<boolean>} Whether the cache was cleared
 */
export const clearServiceWorkerCache = async () => {
  if (!navigator.serviceWorker?.controller) {
    return false;
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      if (event.data?.type === "CACHE_CLEARED") {
        resolve(true);
      }
    };

    navigator.serviceWorker.controller.postMessage({ type: "CLEAR_CACHE" }, [
      channel.port2,
    ]);

    // Timeout after 5 seconds
    setTimeout(() => resolve(false), 5000);
  });
};

/**
 * Force the waiting Service Worker to activate
 */
export const skipWaiting = () => {
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" });
  }
};

/**
 * Check if the app can work offline
 * @returns {Promise<boolean>}
 */
export const isOfflineReady = async () => {
  const status = await getServiceWorkerStatus();
  return status.controller && status.active;
};

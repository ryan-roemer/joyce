/* global self:false, caches:false, URL:false, fetch:false */
/**
 * Service Worker for Joyce - Offline Support
 *
 * Strategies:
 * - App Shell (HTML, CSS, JS): Cache-first with network fallback
 * - CDN Dependencies: Cache on first use, serve from cache thereafter
 * - Data files (posts.json, embeddings): Network-first with cache fallback
 */

// TODO(offline): add versioning to the cache name (based off package.json version?)
const CACHE_VERSION = "v1";
const CACHE_NAME = `joyce-${CACHE_VERSION}`;

// TODO(offline): Need a build script to infer all options and update this list.
// App shell - critical assets for offline functionality
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/config.js",
  "/shared-config.js",
  "/shared-util.js",
  "/app/index.js",
  "/app/util/html.js",
  "/app/components/page.js",
  "/app/components/layout.js",
  "/app/components/menu.js",
  "/app/components/modal.js",
  "/app/components/forms.js",
  "/app/components/answer.js",
  "/app/components/alert.js",
  "/app/components/category.js",
  "/app/components/description.js",
  "/app/components/loading-bubble.js",
  "/app/components/posts-download.js",
  "/app/components/posts-found.js",
  "/app/components/posts-table.js",
  "/app/components/query-display.js",
  "/app/components/suggested-queries.js",
  "/app/contexts/config.js",
  "/app/data/api.js",
  "/app/data/index.js",
  "/app/data/util.js",
  "/app/hooks/use-click-outside.js",
  "/app/hooks/use-escape-key.js",
  "/app/hooks/use-settings.js",
  "/app/hooks/use-table-sort.js",
  "/app/pages/chat.js",
  "/app/pages/data.js",
  "/app/pages/home.js",
  "/app/pages/posts.js",
  "/app/pages/search.js",
  "/app/pages/settings.js",
  "/local/app/components/info-icon.js",
  "/local/app/components/loading/button.js",
  "/local/app/components/loading/index.js",
  "/local/app/components/loading/message.js",
  "/local/app/components/models-filter.js",
  "/local/app/components/models-table.js",
  "/local/app/components/offline-status.js",
  "/local/app/context/loading.js",
  "/local/data/api/chat.js",
  "/local/data/api/index.js",
  "/local/data/api/llm.js",
  "/local/data/api/posts.js",
  "/local/data/api/providers/chrome.js",
  "/local/data/api/providers/web-llm.js",
  "/local/data/api/search.js",
  "/local/data/embeddings.js",
  "/local/data/loading.js",
  "/local/data/storage.js",
  "/local/data/util.js",
];

// CDN hosts to cache
const CDN_HOSTS = ["esm.sh", "cdn.jsdelivr.net"];

// Data files to cache with network-first strategy
const DATA_FILES = [
  "/data/posts.json",
  "/data/posts-embeddings-256.json",
  "/data/posts-embeddings-512.json",
];

/**
 * Install event - precache app shell
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        // Use addAll for app shell, but don't fail install if some fail
        return cache.addAll(APP_SHELL).catch((err) => {
          console.warn("[SW] Some app shell assets failed to cache:", err); // eslint-disable-line no-undef
          // Try to cache what we can individually
          return Promise.allSettled(
            APP_SHELL.map((url) =>
              cache.add(url).catch(
                (e) => console.warn(`[SW] Failed to cache ${url}:`, e), // eslint-disable-line no-undef
              ),
            ),
          );
        });
      })
      .then(() => self.skipWaiting()),
  );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith("joyce-") && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        );
      })
      .then(() => self.clients.claim()),
  );
});

/**
 * Fetch event - handle requests with appropriate strategy
 */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") {
    return;
  }

  // CDN requests - cache on first use
  if (CDN_HOSTS.some((host) => url.host.includes(host))) {
    event.respondWith(cacheFirstWithNetwork(event.request));
    return;
  }

  // Data files - network first with cache fallback
  if (DATA_FILES.some((file) => url.pathname === file)) {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }

  // App shell and other same-origin requests - cache first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstWithNetwork(event.request));
    return;
  }

  // Other requests - network only
  event.respondWith(fetch(event.request));
});

/**
 * Cache-first strategy with network fallback.
 * Good for static assets that don't change often.
 */
async function cacheFirstWithNetwork(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    // Return cached response and update cache in background
    updateCacheInBackground(request, cache);
    return cached;
  }

  // Not in cache, fetch from network
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone response before caching (response can only be read once)
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn("[SW] Network fetch failed:", request.url, err); // eslint-disable-line no-undef
    // Return a fallback offline page if available
    const fallback = await cache.match("/index.html");
    if (fallback) {
      return fallback;
    }
    throw err;
  }
}

/**
 * Network-first strategy with cache fallback.
 * Good for data that changes but should work offline.
 */
async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Update cache with fresh response
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn("[SW] Network failed, trying cache:", request.url); // eslint-disable-line no-undef
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw err;
  }
}

/**
 * Update cache in background (stale-while-revalidate pattern).
 */
function updateCacheInBackground(request, cache) {
  fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response);
      }
    })
    .catch(() => {
      // Ignore background update failures
    });
}

/**
 * Message handler for cache management
 */
self.addEventListener("message", (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;

    case "GET_CACHE_SIZE":
      getCacheSize().then((size) => {
        event.ports[0]?.postMessage({ type: "CACHE_SIZE", size });
      });
      break;

    case "CLEAR_CACHE":
      caches.delete(CACHE_NAME).then(() => {
        event.ports[0]?.postMessage({ type: "CACHE_CLEARED" });
      });
      break;

    case "CACHE_URLS":
      if (payload?.urls) {
        cacheUrls(payload.urls).then(() => {
          event.ports[0]?.postMessage({ type: "URLS_CACHED" });
        });
      }
      break;
  }
});

/**
 * Get approximate cache size in bytes
 */
async function getCacheSize() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  let totalSize = 0;

  for (const request of keys) {
    const response = await cache.match(request);
    if (response) {
      const blob = await response.clone().blob();
      totalSize += blob.size;
    }
  }

  return totalSize;
}

/**
 * Cache specific URLs
 */
async function cacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  return Promise.allSettled(
    urls.map(
      (url) =>
        cache
          .add(url)
          .catch((e) => console.warn(`[SW] Failed to cache ${url}:`, e)), // eslint-disable-line no-undef
    ),
  );
}

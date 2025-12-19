/* global fetch:false,navigator:false,URL:false */

// Derive base path from this module's URL.
// Since util.js is at local/data/util.js, go up 3 levels to reach the static root.
const BASE_PATH = new URL("../../../", import.meta.url).pathname;

// Resolve root-relative paths (starting with "/") to actual paths based on BASE_PATH.
const resolveUrl = (url) => {
  if (url.startsWith("/")) {
    return BASE_PATH + url.slice(1);
  }
  return url;
};

export const fetchWrapper = async (url) => {
  const resolvedUrl = resolveUrl(url);
  let response;
  try {
    response = await fetch(resolvedUrl);
  } catch (err) {
    throw new Error(`Failed to fetch posts data: ${err.message}`);
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch/parse posts data (${response.status}): ${response.statusText}`,
    );
  }
  try {
    return await response.json();
  } catch (err) {
    throw new Error(`Failed to parse posts data: ${err.message}`);
  }
};

/**
 * Detect WebGPU status, GPU capabilities, and system memory.
 *
 * Browser Capabilities & Constraints:
 * - WebGPU (navigator.gpu): Chrome 113+, Edge 113+, Safari 17+. Requires HTTPS.
 *   Provides limits like maxBufferSize but not actual VRAM amount.
 * - Device Memory (navigator.deviceMemory): Chromium-only (not Firefox/Safari).
 *   Returns coarse RAM values (0.25, 0.5, 1, 2, 4, 8 GB) to prevent fingerprinting.
 * - WebGL: Can identify GPU vendor/renderer, but no VRAM reporting.
 * - No browser exposes exact VRAM for privacy/security reasons.
 *
 * @returns {Promise<{
 *   webgpu: {supported: boolean, adapterAvailable: boolean, isFallback: boolean, preferredFormat: string|null},
 *   limits: {maxBufferSize: number|null, maxStorageBufferBindingSize: number|null, maxComputeWorkgroupStorageSize: number|null},
 *   gpuInfo: string|null,
 *   ramGb: number|null
 * }>}
 */
export const getSystemInfo = async () => {
  const webgpu = {
    supported: false,
    adapterAvailable: false,
    isFallback: false,
    preferredFormat: null,
  };
  const limits = {
    maxBufferSize: null,
    maxStorageBufferBindingSize: null,
    maxComputeWorkgroupStorageSize: null,
  };
  let gpuInfo = null;
  let ramGb = null;

  // Check WebGPU support and get adapter info
  if ("gpu" in navigator) {
    webgpu.supported = true;
    webgpu.preferredFormat = navigator.gpu.getPreferredCanvasFormat?.() ?? null;

    const adapter = await navigator.gpu.requestAdapter();
    if (adapter) {
      webgpu.adapterAvailable = true;
      webgpu.isFallback = adapter.info?.isFallbackAdapter ?? false;

      // Key limits for LLM inference
      if (adapter.limits) {
        limits.maxBufferSize = adapter.limits.maxBufferSize ?? null;
        limits.maxStorageBufferBindingSize =
          adapter.limits.maxStorageBufferBindingSize ?? null;
        limits.maxComputeWorkgroupStorageSize =
          adapter.limits.maxComputeWorkgroupStorageSize ?? null;
      }

      // Get GPU description if available
      const info = adapter.info;
      if (info) {
        gpuInfo =
          [info.vendor, info.architecture, info.device]
            .filter(Boolean)
            .join(" ") || null;
      }
    }
  }

  // Device Memory API (Chromium only, coarse values)
  if ("deviceMemory" in navigator) {
    ramGb = navigator.deviceMemory;
  }

  // TODO(WORKERS): Add worker WebGPU support detection

  return { webgpu, limits, gpuInfo, ramGb };
};

// Rough estimate is 0.75 so we go a little conservative.
const TOKENS_PER_WORD = 0.55;

// Token estimator.
export const estimateTokens = (content = "") => {
  return Math.ceil(content.split(/[\s\n]+/).length / TOKENS_PER_WORD);
};

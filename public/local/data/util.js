/* global fetch:false,navigator:false */
export const fetchWrapper = async (url) => {
  let response;
  try {
    response = await fetch(url);
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
 * Detect available GPU/system memory.
 *
 * Browser Capabilities & Constraints:
 * - WebGPU (navigator.gpu): Chrome 113+, Edge 113+, Safari 17+. Requires HTTPS.
 *   Provides maxBufferSize but not actual VRAM amount.
 * - Device Memory (navigator.deviceMemory): Chromium-only (not Firefox/Safari).
 *   Returns coarse RAM values (0.25, 0.5, 1, 2, 4, 8 GB) to prevent fingerprinting.
 * - WebGL: Can identify GPU vendor/renderer, but no VRAM reporting.
 * - No browser exposes exact VRAM for privacy/security reasons.
 *
 * @returns {Promise<{vramMb: number|null, ramGb: number|null, gpuInfo: string|null}>}
 */
export const getSystemInfo = async () => {
  let vramMb = null;
  let gpuInfo = null;
  let ramGb = null;

  // Try WebGPU for GPU info
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        // maxBufferSize is the largest buffer allocatable (rough VRAM proxy)
        const maxBufferBytes = adapter.limits?.maxBufferSize;
        if (maxBufferBytes) {
          vramMb = Math.round(maxBufferBytes / (1024 * 1024));
        }
        // Get GPU description if available
        const info = await adapter.requestAdapterInfo?.();
        if (info) {
          gpuInfo =
            [info.vendor, info.architecture, info.device]
              .filter(Boolean)
              .join(" ") || null;
        }
      }
    } catch (e) {
      console.warn("WebGPU detection failed:", e); // eslint-disable-line no-undef
    }
  }

  // Fallback: Device Memory API (Chromium only, coarse values)
  if (navigator.deviceMemory) {
    ramGb = navigator.deviceMemory;
  }

  return { vramMb, ramGb, gpuInfo };
};

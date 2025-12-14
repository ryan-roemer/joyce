import { html } from "../util/html.js";
import { Page } from "../components/page.js";
import { useConfig } from "../contexts/config.js";
import { MODELS, getModelCfg } from "../../shared-config.js";
import { formatBytes } from "../../shared-util.js";
import { ModelsTable } from "../../local/app/components/models-table.js";
import {
  LoadingButton,
  LOADING,
} from "../../local/app/components/loading/index.js";

// TODO(CHAT): REFACTOR THIS -- brittle to get model short name from resource id.
const modelShortName = (modelId) =>
  getModelCfg({ provider: "webLlm", model: modelId.replace(/^llm_/, "") })
    .modelShortName;

const SystemInfo = ({ info }) => {
  const { webgpu, limits, gpuInfo, ramGb } = info;

  // WebGPU status determination
  const webgpuStatus = !webgpu.supported
    ? { label: "Not Supported", className: "status-unsupported" }
    : !webgpu.adapterAvailable
      ? { label: "No Adapter", className: "status-warning" }
      : webgpu.isFallback
        ? { label: "Fallback (Software)", className: "status-warning" }
        : { label: "Available", className: "status-supported" };

  return html`
    <div className="system-info">
      <div className="system-info-row">
        <strong>WebGPU:</strong>
        <span className=${`status-badge ${webgpuStatus.className}`}>
          ${webgpuStatus.label}
        </span>
        ${gpuInfo && html`<span className="gpu-info">${gpuInfo}</span>`}
      </div>

      <div className="system-info-row">
        <strong>System RAM:</strong> ${ramGb != null ? `${ramGb} GB` : "N/A"}
      </div>
      ${webgpu.adapterAvailable &&
      html`
        <details className="system-info-limits">
          <summary>WebGPU Limits</summary>
          <table className="limits-table">
            <tbody>
              <tr>
                <td>Max Buffer Size</td>
                <td>${formatBytes(limits.maxBufferSize)}</td>
              </tr>
              <tr>
                <td>Max Storage Buffer Binding</td>
                <td>${formatBytes(limits.maxStorageBufferBindingSize)}</td>
              </tr>
              <tr>
                <td>Max Compute Workgroup Storage</td>
                <td>${formatBytes(limits.maxComputeWorkgroupStorageSize)}</td>
              </tr>
              ${webgpu.preferredFormat &&
              html`
                <tr>
                  <td>Preferred Canvas Format</td>
                  <td>${webgpu.preferredFormat}</td>
                </tr>
              `}
            </tbody>
          </table>
        </details>
      `}
    </div>
  `;
};

export const Data = () => {
  const { systemInfo } = useConfig();

  return html`
    <${Page} name="Data & Models">
      <h2 className="content-subhead">Data</h2>
      <p>
        We load data, databases, and models for use in the app.
        Some we automatically load (like our posts data), while others can be loaded
        manually. (If you see a gray circle, this is unloaded data that you can click to load.)
      </p>
      <div>
        <${LoadingButton} resourceId=${LOADING.POSTS_DATA}>
          <strong>Posts</strong>: posts data
        </${LoadingButton}>
        <${LoadingButton} resourceId=${LOADING.POSTS_EMBEDDINGS}>
          <strong>Posts Embeddings</strong>: chunked embeddings for posts data
        </${LoadingButton}>
        <${LoadingButton} resourceId=${LOADING.DB}>
          <strong>Database</strong>: search indexes
        </${LoadingButton}>
        <${LoadingButton} resourceId=${LOADING.EXTRACTOR}>
          <strong>Extractor</strong>: embeddings extraction model
        </${LoadingButton}>
        ${Object.keys(LOADING)
          .filter((key) => key.startsWith("LLM_"))
          .map(
            (key) => html`
              <${LoadingButton} resourceId=${LOADING[key]} key=${key}>
                <strong>Model</strong>: ${modelShortName(LOADING[key])}
              </${LoadingButton}>
            `,
          )}
      </div>
      <div>
        <!-- TODO(LOCAL): Remove these demo buttons -->
        <${LoadingButton} resourceId="demo_not_loaded" label="Demo: Not loaded" forceStatus="not_loaded" />
        <${LoadingButton} resourceId="demo_loading" label="Demo: Loading" forceStatus="loading" />
        <${LoadingButton} resourceId="demo_loaded" label="Demo: Loaded" forceStatus="loaded" />
        <${LoadingButton} resourceId="demo_error" label="Demo: Error" forceStatus="error" />
      </div>

      <h2 className="content-subhead">Models</h2>

      <${SystemInfo} info=${systemInfo} />

      <h3>web-llm</h3>
      <p>
        Available web-llm models for local inference. Status
        indicates whether the model is loaded in memory, currently loading, or
        available for download.
      </p>
      <${ModelsTable} models=${MODELS} />

      <!-- TODO(GOOGLE): Add Google AI models section when provider is enabled -->
    </${Page}>
  `;
};

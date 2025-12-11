import { useState } from "react";
import { html } from "../../../app/util/html.js";
import { useTableSort } from "../../../app/hooks/use-table-sort.js";
import { useLoading } from "../context/loading.js";
import { LOADING } from "./loading/index.js";
import { ModelsFilter } from "./models-filter.js";
import { InfoIcon } from "./info-icon.js";

const DEFAULT_FILTERS = {
  modelText: "",
  quantization: [],
  maxTokens: [],
  vramMin: null,
  vramMax: null,
};

const HEADINGS = {
  model: "Model",
  quantization: "Quant",
  maxTokens: "Tokens",
  vramMb: "VRAM",
  status: "Status",
};

const COLUMN_INFO = {
  model: {
    tooltip: "Model identifier",
    modalTitle: "Model",
    modalContent: html`
      <p>
        The unique model ID from
        <a
          href="https://github.com/mlc-ai/web-llm"
          target="_blank"
          rel="noopener noreferrer"
        >
          MLC-AI web-llm <i className="iconoir-open-new-window"></i> </a
        >.
      </p>
      <p>Click a model name in the table to view it on Hugging Face.</p>
    `,
  },
  quantization: {
    tooltip: "Quantization format",
    modalTitle: "Quantization",
    modalContent: html`
      <p>
        Quantization reduces model size and memory usage by lowering the
        precision of weights.
      </p>
      <p>Format: <code>q{"{bits}"}f{"{float_bits}"}</code></p>
      <ul>
        <li><strong>q4f16_1</strong> — 4-bit weights with float16 compute</li>
        <li><strong>q0f32</strong> — Full precision (no quantization)</li>
      </ul>
      <p>Lower bit counts = smaller size but potentially lower quality.</p>
    `,
  },
  maxTokens: {
    tooltip: "Context window size",
    modalTitle: "Max Tokens",
    modalContent: html`
      <p>
        The maximum number of tokens the model can process in a single prompt +
        response.
      </p>
      <p>
        Larger context windows allow for longer conversations and more context,
        but require more memory.
      </p>
    `,
  },
  vramMb: {
    tooltip: "GPU memory required",
    modalTitle: "VRAM",
    modalContent: html`
      <p>Estimated GPU memory (in MB) needed to load and run the model.</p>
      <p>
        Your browser needs sufficient GPU memory available to load the model.
        Models with lower VRAM requirements load faster and work on more
        devices.
      </p>
    `,
  },
  status: {
    tooltip: "Loading status",
    modalTitle: "Status",
    modalContent: html`
      <p>Shows the current loading state of the model:</p>
      <ul>
        <li><strong>loaded</strong> — Model is ready to use</li>
        <li><strong>loading</strong> — Model is currently being loaded</li>
        <li><strong>available</strong> — Model can be loaded on demand</li>
      </ul>
    `,
  },
};

// Build MODEL_RESOURCE_MAP dynamically from LOADING LLM_ keys
const MODEL_RESOURCE_MAP = Object.fromEntries(
  Object.entries(LOADING)
    .filter(([key]) => key.startsWith("LLM_"))
    .map(([, resourceId]) => [resourceId.replace(/^llm_/, ""), resourceId]),
);

const StatusBadge = ({ status }) => {
  const styles = {
    loaded: { backgroundColor: "#4caf50", color: "white" },
    loading: { backgroundColor: "#2196f3", color: "white" },
    cached: { backgroundColor: "#9c27b0", color: "white" },
    available: { backgroundColor: "#e0e0e0", color: "#666" },
  };

  const style = {
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    ...(styles[status] || styles.available),
  };

  return html`<span style=${style}>${status || "—"}</span>`;
};

export const ModelsTable = ({ models = [] }) => {
  const { getSortSymbol, handleColumnSort, sortItems } = useTableSort();
  const { getStatus } = useLoading();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  if (models.length === 0) {
    return html`<div />`;
  }

  // Enrich models with status
  const enrichedModels = models.map((m) => {
    const resourceId = MODEL_RESOURCE_MAP[m.model];
    let status = null;
    if (resourceId) {
      const loadingStatus = getStatus(resourceId);
      if (loadingStatus === "loaded") {
        status = "loaded";
      } else if (loadingStatus === "loading") {
        status = "loading";
      } else {
        status = "available";
      }
    }
    return { ...m, status };
  });

  // Apply filters
  const filteredModels = enrichedModels
    .filter(
      (m) =>
        !filters.modelText ||
        m.model.toLowerCase().includes(filters.modelText.toLowerCase()),
    )
    .filter(
      (m) =>
        filters.quantization.length === 0 ||
        filters.quantization.some((q) => q.value === m.quantization),
    )
    .filter(
      (m) =>
        filters.maxTokens.length === 0 ||
        filters.maxTokens.some((t) => t.value === m.maxTokens),
    )
    .filter((m) => filters.vramMin == null || m.vramMb >= filters.vramMin)
    .filter((m) => filters.vramMax == null || m.vramMb <= filters.vramMax);

  return html`
    <div>
      <${ModelsFilter}
        models=${models}
        filters=${filters}
        setFilters=${setFilters}
      />
      <div style=${{ overflowX: "auto" }}>
        <table className="pure-table pure-table-bordered">
          <thead>
            <tr>
              ${Object.entries(HEADINGS).map(([key, label]) => {
                const info = COLUMN_INFO[key];
                return html`<th
                  key=${key}
                  style=${{ whiteSpace: "nowrap", cursor: "pointer" }}
                  onClick=${() => handleColumnSort(key)}
                >
                  ${label}${" "}${getSortSymbol(key)}
                  ${info &&
                  html`<${InfoIcon}
                    tooltip=${info.tooltip}
                    modalTitle=${info.modalTitle}
                  >
                    ${info.modalContent}
                  </${InfoIcon}>`}
                </th>`;
              })}
            </tr>
          </thead>
          <tbody>
            ${sortItems(filteredModels).map(
              (
                { model, modelUrl, quantization, maxTokens, vramMb, status },
                i,
              ) => {
                return html`
                  <tr key=${`model-item-${i}`}>
                    <td>
                      <a
                        href="${modelUrl}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ${model}
                      </a>
                    </td>
                    <td>${quantization ?? "—"}</td>
                    <td>${maxTokens ?? "—"}</td>
                    <td>${vramMb ?? "—"}</td>
                    <td><${StatusBadge} status=${status} /></td>
                  </tr>
                `;
              },
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

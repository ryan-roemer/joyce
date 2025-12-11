import { useState } from "react";
import { html } from "../../../app/util/html.js";
import { useTableSort } from "../../../app/hooks/use-table-sort.js";
import { useLoading } from "../context/loading.js";
import { LOADING } from "./loading/index.js";
import { ModelsFilter } from "./models-filter.js";

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
  model: "Model identifier",
  quantization: "Quantization format",
  maxTokens: "Context window size",
  vramMb: "GPU memory required",
  status: "Loading status",
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
                const tooltip = COLUMN_INFO[key];
                return html`<th
                  key=${key}
                  style=${{ whiteSpace: "nowrap", cursor: "pointer" }}
                  title=${tooltip}
                  onClick=${() => handleColumnSort(key)}
                >
                  ${label}${" "}${getSortSymbol(key)}
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

import { html } from "../../../app/util/html.js";
import { useTableSort } from "../../../app/hooks/use-table-sort.js";
import { useLoading } from "../context/loading.js";
import { LOADING } from "./loading/index.js";

const HEADINGS = {
  model: "Model",
  quantization: "Quant",
  maxTokens: "Tokens",
  vramMb: "VRAM",
  status: "Status",
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

  return html`
    <div>
      <table className="pure-table pure-table-bordered">
        <thead>
          <tr>
            ${Object.entries(HEADINGS).map(
              ([key, label]) =>
                html`<th
                  key=${key}
                  style=${{ whiteSpace: "nowrap", cursor: "pointer" }}
                  onClick=${() => handleColumnSort(key)}
                >
                  ${label}${" "}${getSortSymbol(key)}
                </th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${sortItems(enrichedModels).map(
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
  `;
};

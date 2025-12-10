import Select from "react-select";
import { html } from "../../../app/util/html.js";

// Build unique sorted options from model data
const buildOptions = (models, key, formatLabel = (v) => v) =>
  [...new Set(models.map((m) => m[key]).filter(Boolean))]
    .sort((a, b) =>
      typeof a === "number" ? a - b : String(a).localeCompare(String(b)),
    )
    .map((value) => ({ label: formatLabel(value), value }));

export const ModelsFilter = ({ models, filters, setFilters }) => {
  const quantizationOptions = buildOptions(models, "quantization");
  const maxTokensOptions = buildOptions(models, "maxTokens", (v) =>
    v.toLocaleString(),
  );

  const updateFilter = (key) => (value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return html`
    <div
      className="pure-form form-filter-row"
      style=${{
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        marginBottom: "16px",
        alignItems: "flex-end",
      }}
    >
      <label style=${{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span>Model</span>
        <input
          type="text"
          placeholder="Filter by name..."
          value=${filters.modelText}
          onInput=${(e) => updateFilter("modelText")(e.target.value)}
          style=${{ width: "180px" }}
        />
      </label>

      <label style=${{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span>Quantization</span>
        <div className="form-multi-select">
          <${Select}
            isMulti=${true}
            placeholder="Any..."
            options=${quantizationOptions}
            value=${filters.quantization}
            onChange=${updateFilter("quantization")}
            menuPlacement="auto"
          />
        </div>
      </label>

      <label style=${{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span>Max Tokens</span>
        <div className="form-multi-select">
          <${Select}
            isMulti=${true}
            placeholder="Any..."
            options=${maxTokensOptions}
            value=${filters.maxTokens}
            onChange=${updateFilter("maxTokens")}
            menuPlacement="auto"
          />
        </div>
      </label>

      <label style=${{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span>VRAM (MB)</span>
        <input
          type="number"
          placeholder="Min..."
          value=${filters.vramMin ?? ""}
          onInput=${(e) =>
            updateFilter("vramMin")(
              e.target.value ? Number(e.target.value) : null,
            )}
          className="vram-input"
          min="0"
        />
      </label>

      <label style=${{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span>VRAM (MB)</span>
        <input
          type="number"
          placeholder="Max..."
          value=${filters.vramMax ?? ""}
          onInput=${(e) =>
            updateFilter("vramMax")(
              e.target.value ? Number(e.target.value) : null,
            )}
          className="vram-input"
          min="0"
        />
      </label>

      ${filters.vramMin != null &&
      filters.vramMax != null &&
      filters.vramMax <= filters.vramMin &&
      html`
        <span className="filter-validation-error">
          Max must be greater than min
        </span>
      `}
    </div>
  `;
};

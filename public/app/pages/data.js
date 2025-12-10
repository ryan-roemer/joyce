import { html } from "../util/html.js";
import { Page } from "../components/page.js";
import { MODELS } from "../../shared-config.js";
import { ModelsTable } from "../../local/app/components/models-table.js";
import {
  LoadingButton,
  LOADING,
} from "../../local/app/components/loading/index.js";
import { getModelCfg } from "../../shared-config.js";

// TODO(CHAT): REFACTOR THIS -- brittle to get model short name from resource id.
const modelShortName = (modelId) =>
  getModelCfg({ provider: "webLlm", model: modelId.replace(/^llm_/, "") })
    .modelShortName;

export const Data = () => {
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
            (key, idx) => html`
              <${LoadingButton} resourceId=${LOADING[key]} key=${key}>
                <strong>Model</strong>: ${modelShortName(LOADING[key])}${idx === 0 ? " (default)" : ""}
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
      <p>
        Available web-llm models (filtered to q4f16_1 quantization). Status
        indicates whether the model is loaded in memory, currently loading, or
        available for download.
      </p>
      <${ModelsTable} models=${MODELS} />
    </${Page}>
  `;
};

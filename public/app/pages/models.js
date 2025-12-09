import { html } from "../util/html.js";
import { Page } from "../components/page.js";
import { MODELS } from "../../shared-config.js";
import { ModelsTable } from "../../local/app/components/models-table.js";

export const Models = () => {
  return html`
    <${Page} name="Models">
      <p>
        Available web-llm models (filtered to q4f16_1 quantization). Status
        indicates whether the model is loaded in memory, currently loading, or
        available for download.
      </p>
      <${ModelsTable} models=${MODELS} />
    </${Page}>
  `;
};

import { useState, Fragment } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { html } from "../util/html.js";
import { useSettings } from "../hooks/use-settings.js";
import { ALL_PROVIDERS, getModelCfg } from "../../shared-config.js";

const formatInt = (num) =>
  (num ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const formatFloat = (num) =>
  (num ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const formatElapsed = (elapsed) => {
  if (elapsed === null || elapsed === undefined) {
    return "";
  } else if (elapsed < 1000) {
    return `${elapsed.toFixed(0)}ms`;
  }
  return `${(elapsed / 1000).toFixed(2)}s`;
};

const QueryInfo = ({
  elapsed,
  usage,
  model,
  provider,
  providerApi,
  chunks,
  internal,
} = {}) => {
  if (!elapsed && !usage && !model && !chunks) return null;

  const totalElapsed = elapsed?.tokensLast
    ? formatElapsed(elapsed.tokensLast)
    : null;

  // Look up model config
  const modelCfg = getModelCfg({ provider, model });
  const maxTokens = modelCfg ? formatInt(modelCfg.maxTokens) : null;
  // Infer cost availability from pricing config
  const hasCost = modelCfg?.pricing && usage?.input?.cost != null;
  const totalCost = hasCost
    ? (usage.input.cost + usage.output.cost).toFixed(2)
    : null;

  const ElapsedDelta = ({ delta }) =>
    html`<${Fragment}><i className="iconoir-triangle"></i> ${formatElapsed(delta)}</${Fragment}>`;

  return html`
    <details className="query-info">
      <summary>
        <em>Query Info</em> (
        ${model && html`${model}${(totalElapsed || usage) && ", "}`}
        ${totalElapsed && html`${totalElapsed}${hasCost && ", "}`}
        ${hasCost && html`$${totalCost}`})
      </summary>

      <div>
        ${model &&
        html`
          <div key="model">
            <strong>Model:</strong> ${model}
            <ul>
              ${provider && html`<li>Provider: ${ALL_PROVIDERS[provider]}</li>`}
              ${providerApi && html`<li>API: ${providerApi}</li>`}
              ${maxTokens && html`<li>Input: ${maxTokens} max tokens</li>`}
            </ul>
          </div>
        `}
        ${elapsed &&
        html`
          <${Fragment}>
            <div>
              <strong>Elapsed time:</strong> ${totalElapsed}
            </div>
            <ul>
              <li>
                Start: ${formatElapsed(0)}
              </li>
              ${
                elapsed.embeddingQuery && elapsed.embeddingQuery
                  ? html`
                  <${Fragment}>
                    <li>Embeddings: ${formatElapsed(elapsed.embeddingQuery)} (<${ElapsedDelta} delta=${elapsed.embeddingQuery} />)</li>
                    <li>DB chunks: ${formatElapsed(elapsed.databaseQuery)} (<${ElapsedDelta} delta=${elapsed.databaseQuery - elapsed.embeddingQuery} />)</li>
                  </${Fragment}>
                `
                  : html`<li>
                      Chunks: ${formatElapsed(elapsed.chunks)} (<${ElapsedDelta}
                        delta=${elapsed.chunks}
                      />)
                    </li>`
              }
              <li>
                First Token: ${formatElapsed(elapsed.tokensFirst)}
                ${" "}(<${ElapsedDelta} delta=${elapsed.tokensFirst - elapsed.chunks} />)
              </li>
              <li>
                Last Token: ${formatElapsed(elapsed.tokensLast)}
                ${" "}(<${ElapsedDelta} delta=${elapsed.tokensLast - elapsed.tokensFirst} />)
              </li>
            </ul>
          </${Fragment}>
        `}
        ${usage &&
        html`
          <${Fragment}>
            <div>
              <strong>Usage:</strong>
            </div>
            <ul>
              <li>
                Input: ${hasCost && html`$${formatFloat(usage.input.cost)}, `}${formatInt(usage.input.tokens)} tokens
                ${" "}(${formatInt(usage.input.cachedTokens)} cached)
              </li>
              <li>
                Output: ${hasCost && html`$${formatFloat(usage.output.cost)}, `}${formatInt(usage.output.tokens)} tokens
                ${" "}(${formatInt(usage.output.reasoningTokens)} reasoning)
              </li>
            </ul>
          </${Fragment}>
        `}
        ${chunks &&
        html`
          <${Fragment}>
            <div>
              <strong>Chunks:</strong>
            </div>
            <ul>
              <li>
                Count: ${formatInt(chunks.numChunks)} chunks
              </li>
              <li>
                Similarity: ${formatFloat(chunks.similarityMin)} - ${formatFloat(chunks.similarityMax)} (avg: ${formatFloat(chunks.similarityAvg)})
              </li>
            </ul>
          </${Fragment}>
        `}
        ${internal &&
        internal.queries?.length > 0 &&
        html`
          <${Fragment}>
            <div>
              <strong>Internal:</strong>
            </div>
            <ul>
              ${
                internal.queries &&
                internal.queries.length > 0 &&
                html`
                  <li>
                    <details>
                      <summary>Queries: ${internal.queries.length}</summary>
                      <ul style=${{ listStyle: "none" }}>
                        ${internal.queries.map(
                          (query, i) =>
                            html`<li key=${`internal-query-${i}`}>
                              ${query}
                            </li>`,
                        )}
                      </ul>
                    </details>
                  </li>
                `
              }
            </ul>
          </${Fragment}>
        `}
      </div>
    </details>
  `;
};

const AnswerContainer = ({
  children,
  isDeveloperMode,
  isRaw,
  setIsRaw,
}) => html`
  <div className="answer" style=${{ position: "relative" }}>
    <${Fragment}>
      <div
        className="pure-button-group"
        role="group"
      >
        ${
          isDeveloperMode &&
          html`
          <${Fragment}>
            <button
              onClick=${() => setIsRaw(false)}
              className=${`pure-button ${!isRaw ? "pure-button-active" : ""}`}
            >
              <i className="iconoir-empty-page"></i>
              HTML
            </button>
            <button
              onClick=${() => setIsRaw(true)}
              className=${`pure-button ${isRaw ? "pure-button-active" : ""}`}
            >
              <i className="iconoir-code"></i>
              Raw
            </button>
          </${Fragment}>
        `
        }
      </div>
    </${Fragment}>
    ${children}
  </div>
`;

export const Answer = ({ answer, queryInfo }) => {
  const [isRaw, setIsRaw] = useState(false);
  const [settings] = useSettings();
  const { isDeveloperMode } = settings;

  let answerSection = null;
  if (isRaw && isDeveloperMode) {
    answerSection = html`<div className="answer-raw">
      ${answer
        .split("\n")
        .map((par, i) => html`<p key=${`answer-par-${i}`}>${par}</p>`)}
    </div>`;
  } else {
    // Sanitize and render markdown
    const renderedHtml = marked.parse(answer, { breaks: true, gfm: true });
    const sanitizedHtml = DOMPurify.sanitize(renderedHtml);
    answerSection = html`
      <div
        className="markdown-body"
        dangerouslySetInnerHTML=${{ __html: sanitizedHtml }}
      />
    `;
  }

  return html`
    <${Fragment}>
      <${AnswerContainer} ...${{ isDeveloperMode, isRaw, setIsRaw }}>
        ${answerSection}
      </${AnswerContainer}>
      ${isDeveloperMode && queryInfo && html`<${QueryInfo} ...${queryInfo} />`}
    </${Fragment}>
  `;
};

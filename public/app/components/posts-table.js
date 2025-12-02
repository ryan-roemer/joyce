import { useState } from "react";
import { html } from "../util/html.js";
import { Category } from "./category.js";
import { useSettings } from "../hooks/use-settings.js";

const BASE_HEADINGS = {
  date: "Date",
  title: "Title",
  "categories.primary": "Cat.",
};

const ANALYTICS_HEADINGS = {
  "analytics.views": "Views",
  "analytics.users": "Users",
  "analytics.time": "Time",
  "analytics.bounceRate": "Bounce",
};

const SORT_DIRS = {
  ASC: "asc",
  DESC: "desc",
};

const sortIconHtml = (className) =>
  html`<i title="Sort" className="ui-icon-button ${className}"></i>`;

const SORT_CHARS = {
  [SORT_DIRS.ASC]: sortIconHtml("iconoir-sort-up"),
  [SORT_DIRS.DESC]: sortIconHtml("iconoir-sort-down"),
  empty: sortIconHtml("iconoir-sort"),
};

const useTableSort = (initialSort = { key: null, direction: null }) => {
  const [sort, setSort] = useState(initialSort);

  const getSortSymbol = (key) => {
    if (sort.key === key) {
      return SORT_CHARS[sort.direction || "empty"];
    }
    return SORT_CHARS.empty;
  };

  const handleColumnSort = (key) => {
    // Default to ascending.
    let direction = SORT_DIRS.ASC;

    // If same key as before iterate to next step.
    if (sort.key === key) {
      if (sort.direction === SORT_DIRS.ASC) {
        direction = SORT_DIRS.DESC;
      } else if (sort.direction === SORT_DIRS.DESC) {
        direction = null;
        key = null;
      }
    }

    // Update state.
    setSort({ key, direction });
  };

  // Handle easy strings and numbers
  const compare = (a, b) => {
    // String.
    if (
      (typeof a === "string" || a === null) &&
      (typeof b === "string" || b === null)
    ) {
      return (a || "").localeCompare(b || "");
    }

    // Naively assume everything else fits in here.
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  };

  // This is why having nested items was maybe a mistake. :P
  const getVal = (key, val) => {
    if (key.includes(".")) {
      let keys = key.split(".");
      let value = val;
      for (let k of keys) {
        value = value[k];
        if (value === undefined) {
          break;
        }
      }

      return value;
    }

    return val[key];
  };

  const sortItems = (items) => {
    if (sort.key && sort.direction) {
      const dir = sort.direction === SORT_DIRS.ASC ? 1 : -1;

      // Clone before our sort.
      return Object.values(items).sort((a, b) => {
        let aVal = getVal(sort.key, a);
        let bVal = getVal(sort.key, b);

        return dir * compare(aVal, bVal);
      });
    }
    return items;
  };

  return { sort, getSortSymbol, handleColumnSort, sortItems };
};

export const PostsTable = ({
  heading,
  posts = [],
  analyticsDates = { start: null, end: null },
}) => {
  const { getSortSymbol, handleColumnSort, sortItems } = useTableSort();
  const [settings] = useSettings();

  // Short-circuit.
  if (posts.length === 0) {
    return html`<div />`;
  }

  // Get the appropriate headings based on settings
  const headings = settings.displayAnalytics
    ? { ...BASE_HEADINGS, ...ANALYTICS_HEADINGS }
    : BASE_HEADINGS;

  const analyticsTitle =
    analyticsDates.start !== null && analyticsDates.end !== null
      ? `Analytics from ${new Date(analyticsDates.start).toLocaleDateString()} to ${new Date(analyticsDates.end).toLocaleDateString()}`
      : "";

  return html`
    <div>
      <h2 className="content-subhead">${heading}</h2>
      <table className="pure-table pure-table-bordered">
        <thead>
          <tr>
            ${Object.entries(headings).map(
              ([key, label]) =>
                html`<th
                  key=${key}
                  style=${{ whiteSpace: "nowrap" }}
                  title="${key.startsWith("analytics.") ? analyticsTitle : ""}"
                  onClick=${() => handleColumnSort(key)}
                >
                  ${label}${" "}${getSortSymbol(key)}
                </th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${sortItems(posts).map(
            (
              {
                date,
                title,
                href,
                categories,
                analytics,
                similarity,
                embeddingNumTokens,
              },
              i,
            ) => {
              return html`
                <tr key=${`post-item-${i}`}>
                  <td style=${{ minWidth: "90px" }}>
                    ${date ? new Date(date).toISOString().substring(0, 10) : ""}
                  </td>
                  <td
                    title=${JSON.stringify({
                      embeddingNumTokens,
                      similarity,
                    })}
                  >
                    <a href="${href}">${title}</a>
                  </td>
                  <td>${Category({ category: categories.primary })}</td>
                  ${settings.displayAnalytics
                    ? html`
                        <td key="views">${analytics.views}</td>
                        <td key="users">${analytics.users}</td>
                        <td key="time">${analytics.time.toFixed(2)}</td>
                        <td key="bounceRate">
                          ${(analytics.bounceRate * 100).toFixed(0)}%
                        </td>
                      `
                    : null}
                </tr>
              `;
            },
          )}
        </tbody>
      </table>
    </div>
  `;
};

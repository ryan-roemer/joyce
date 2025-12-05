import { Fragment } from "react";
import { Link } from "react-router";
import { html } from "../util/html.js";
import { Page } from "../components/page.js";
import { useSettings } from "../hooks/use-settings.js";
import { ShortDescription as ChatShortDescription } from "./chat.js";
import { DownloadButton } from "../../local/app/components/downloads/button.js";

// TODO(LOCAL): Need to redo all text to discuss SLMs and our techniques.
export const Home = () => {
  const [settings] = useSettings();
  const { isDeveloperMode } = settings;

  return html`
    <${Page} name="Joyce">
      ${
        !isDeveloperMode &&
        html`
        <${Fragment}>
          <p>
            This site incorporates Nearform's blogs, case studies, and services pages to provide
            tools to find, list, and generate text answers using AI.
            Go ahead and try it out!
            ${" "}<i className="iconoir-sparks-solid"></i>
          </p>
          <ul>
            <li id="posts"><${Link} to="/posts">Posts</${Link}>: Browse / filter all available content.</li>
            <li id="search"><${Link} to="/search">Search</${Link}>: Find / filter similar posts to a query.</li>
            <li id="chat"><${Link} to="/chat">Chat</${Link}>: Get answers from AI using our content.</li>
          </ul>
        </${Fragment}>
        `
      }
      ${
        isDeveloperMode &&
        html`
        <${Fragment}>
          <h2 className="content-subhead">Introduction</h2>
          <p>
            This site provides a little bit of introduction to some AI concepts using some of the
            Nearform blogs and case studies as our data source for useful information and examples.
            To take a glance at all of the source data, please head over to
            the <${Link} to="/posts">posts</${Link}> page.
          </p>
          <p>
            We scrape all blog and work/case study post data directly from our websites and first store
            as JSON on local disk and add embeddings using a small emebddings
            model (currently <a href="https://huggingface.co/Xenova/gte-small"><code>gte-small</code></a>).
            Then we load the data into an <a href="https://docs.oramasearch.com/docs/orama-js">Orama</a> database,
            where we store basic metadata and  mbeddings for each post. (This allows us to perform similarity searches).
          </p>

          <h2 className="content-subhead">Similarity Search</h2>
          <p>
            The <${Link} to="/search">search</${Link}> page allows you to find similar posts based on a
            query. To facilitate this, we get embeddings for the query using the same model we used for
            the posts storage in the database. We then perform a similarity search
            (<a href="https://www.imaurer.com/which-vector-similarity-metric-should-i-use/">cosine distance</a>)
            in the database to find the top "n" most similar posts.
          </p>

          <h2 className="content-subhead">Chat</h2>
          <${ChatShortDescription} />

          <h2 className="content-subhead">Downloads</h2>
          <div>
            <${DownloadButton} resourceId="posts_data" label="Posts data" />
            <${DownloadButton} resourceId="demo_not_loaded" label="Demo: Not loaded" forceStatus="not_loaded" />
            <${DownloadButton} resourceId="demo_loading" label="Demo: Loading" forceStatus="loading" />
            <${DownloadButton} resourceId="demo_loaded" label="Demo: Loaded" forceStatus="loaded" />
            <${DownloadButton} resourceId="demo_error" label="Demo: Error" forceStatus="error" />
          </div>
        </${Fragment}>
        `
      }
    </${Page}>
  `;
};

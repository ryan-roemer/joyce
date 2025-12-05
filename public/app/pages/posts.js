import { useState, useEffect } from "react";
import { html } from "../util/html.js";
import { Page } from "../components/page.js";
import { PostsTable } from "../components/posts-table.js";
import {
  Form,
  PostMinDate,
  PostTypeSelect,
  PostCategoryPrimarySelect,
} from "../components/forms.js";
import {
  DownloadPostsCsv,
  JsonDataLink,
} from "../components/posts-download.js";
import { useSettings } from "../hooks/use-settings.js";
import { posts as getPosts } from "../data/index.js";
import { useDownloads } from "../../local/app/context/downloads.js";
import { StatusMessage } from "../../local/app/components/status-message.js";

export const Posts = () => {
  const [posts, setPosts] = useState(null);
  const [postsData, setPostsData] = useState(null);
  const [analyticsDates, setAnalyticsDates] = useState({
    start: null,
    end: null,
  });
  const [selectedPostTypes, setSelectedPostTypes] = useState([]);
  const [selectedCategoryPrimary, setSelectedCategoryPrimary] = useState([]);
  const [minDate, setMinDate] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [settings] = useSettings();
  const { isDeveloperMode } = settings;
  const { getStatus } = useDownloads();
  const postsDataStatus = getStatus("posts_data");

  // Helper function to fetch posts
  const fetchPosts = async () => {
    const data = await getPosts({
      minDate,
      postType: selectedPostTypes.map(({ value }) => value),
      categoryPrimary: selectedCategoryPrimary.map(({ value }) => value),
      withContent: false,
    });
    setPostsData(data);
    setPosts(data.posts);
    setAnalyticsDates(data.metadata?.analytics?.dates);
  };

  useEffect(() => {
    fetchPosts();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsFetching(true);
    setPosts(null);
    setPostsData(null);
    await fetchPosts();
    setIsFetching(false);
  };

  return html`
    <${Page} name="Posts">
      <p>
        List (and filter) blog / case study / services
        pages${isDeveloperMode && ", without querying a database or service"}.
        ${" "}
        ${isDeveloperMode && postsData && html`<${JsonDataLink} data=${postsData} />`}
        <${DownloadPostsCsv} posts=${posts} />
      </p>
      <${StatusMessage}
        resourceId="posts_data"
        type="info"
        message=${postsDataStatus === "loading" ? "Loading posts data..." : null}
      />
      <${StatusMessage} resourceId="posts_data" type="error" />
      <${Form} ...${{ isFetching, handleSubmit, submitName: "Filter" }}>
        <${PostTypeSelect}
          selected=${selectedPostTypes}
          setSelected=${setSelectedPostTypes}
        />
        <${PostCategoryPrimarySelect}
          selected=${selectedCategoryPrimary}
          setSelected=${setSelectedCategoryPrimary}
        />
        <${PostMinDate} value=${minDate} setValue=${setMinDate} />
      </${Form}>
      ${(posts && html`<${PostsTable} posts=${posts} analyticsDates=${analyticsDates} />`) || html`<p>Loading...</p>`}
    </${Page}>
  `;
};

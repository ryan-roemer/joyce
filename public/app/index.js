import { html } from "./util/html.js";
import { Layout } from "./components/layout.js";
import { ConfigProvider } from "./contexts/config.js";

export const App = (props) => {
  const { config = {}, ...otherProps } = props;
  return html`
    <${ConfigProvider} config=${config}>
      <${Layout} ...${otherProps} />
    </${ConfigProvider}>
  `;
};

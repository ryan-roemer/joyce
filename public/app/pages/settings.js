/* global setTimeout:false */
import { useState } from "react";
import { Link } from "react-router";
import { html } from "../util/html.js";
import { Page } from "../components/page.js";
import { Form, Checkbox } from "../components/forms.js";
import { useSettings } from "../hooks/use-settings.js";
import { Alert } from "../components/alert.js";

// Duration to show success message (in milliseconds)
const SUCCESS_MESSAGE_DURATION = 3000;

export const Settings = () => {
  const [settings, updateSettings] = useSettings();
  const [showSuccess, setShowSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [pendingSettings, setPendingSettings] = useState(settings);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (hasChanges) {
      updateSettings(pendingSettings);
      setShowSuccess(true);
      setHasChanges(false);
      // Hide success message after specified duration
      setTimeout(() => setShowSuccess(false), SUCCESS_MESSAGE_DURATION);
    }
  };

  const handleSettingChange = (settingKey) => (event) => {
    const newSettings = {
      ...pendingSettings,
      [settingKey]: event.target.checked,
    };
    setPendingSettings(newSettings);
    setHasChanges(newSettings[settingKey] !== settings[settingKey]);
  };

  return html`
    <${Page} name="Settings">
      <p>Configure application-wide settings and preferences.</p>

      ${showSuccess && html`<${Alert} type="success">Settings saved successfully!</${Alert}>`}

      <${Form} handleSubmit=${handleSubmit} submitName="Save Settings" isFetching=${!hasChanges}>
        <fieldset>
          <legend>Modes</legend>

          <${Checkbox}
            id="developer-mode"
            label="Developer Mode"
            checked=${pendingSettings.isDeveloperMode}
            onChange=${handleSettingChange("isDeveloperMode")}
          >
            Show full developer options and features (choice of models,
            temperature, etc.).
          </${Checkbox}>

          <legend>Information</legend>

          <${Checkbox}
            id="display-model-stats"
            label="Display Model Stats"
            checked=${pendingSettings.displayModelStats}
            onChange=${handleSettingChange("displayModelStats")}
          >
            Show model token limits and pricing in the UI.
          </${Checkbox}>

          <${Checkbox}
            id="display-analytics"
            label="Display Analytics"
            checked=${pendingSettings.displayAnalytics}
            onChange=${handleSettingChange("displayAnalytics")}
          >
            Show analytics information in the posts table view.
          </${Checkbox}>

          <legend>Experimental</legend>

          ${"" /* TODO(openai-tool): Remove feature flag when fully enabled. */}
          <${Checkbox}
            id="feature-openai-tool-enabled"
            label="OpenAI File Search Tool"
            checked=${pendingSettings.featureOpenAIToolEnabled}
            onChange=${handleSettingChange("featureOpenAIToolEnabled")}
          >
            Enable the <a href="https://platform.openai.com/docs/guides/tools-file-search">vector store
            file search</a> tool in Responses API calls under the hood in
            the <${Link} to="/chat">Chat</${Link}> page via the option "OpenAI Tool".
            ${" "}<em>Note</em>: the matched file results so far don't seem as good as the separate
            datastore lookups (either via OpenAI's direct vector search or Postgres).
          </${Checkbox}>
        </fieldset>
      </${Form}>
    </${Page}>
  `;
};

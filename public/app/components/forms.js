/* global window:false */
import Select from "react-select";
import { html } from "../util/html.js";
import { CATEGORIES_LIST } from "./category.js";
import {
  ALL_CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
  ALL_PROVIDERS,
  // CHAT_MODELS_MAP, // TODO(CHAT): REMOVE?
  DEFAULT_DATASTORE,
  DEFAULT_API,
  DEFAULT_TEMPERATURE,
} from "../../shared-config.js";
import { useSettings } from "../hooks/use-settings.js";
import { useState, createContext, useContext } from "react";
import { useClickOutside } from "../hooks/use-click-outside.js";

const CATEGORY_OPTIONS = CATEGORIES_LIST.map((category) => ({
  label: category,
  value: category,
}));

const POST_TYPE_OPTIONS = [
  { label: "Services", value: "service" },
  { label: "Work", value: "work" },
  { label: "Blogs", value: "blog" },
];

export const IS_LOCALHOST =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "[::1]";

// ================================================================================================
// Helpers
// ================================================================================================
const getTargetValue = (eventOrString) => {
  if (typeof eventOrString === "object" && eventOrString?.target) {
    return eventOrString.target.value;
  }

  return eventOrString;
};

// ================================================================================================
// Chat Form Context API
// ================================================================================================
export const ChatFormContext = createContext({ onDropdownToggle: () => {} });

export const ChatFormProvider = ({ onDropdownToggle = () => {}, children }) => {
  return html`<${ChatFormContext.Provider} value=${{ onDropdownToggle }}>
    ${children}
  <//>`;
};

export const useChatForm = () => useContext(ChatFormContext);

// ================================================================================================
// Abstractions
// ================================================================================================
// Generic dropdown wrapper for form controls
export const DropdownWrapper = ({
  icon = "iconoir-chevron-down",
  iconTitle = "Show options",
  isChanged = false,
  hidden = false,
  className,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { onDropdownToggle } = useChatForm();
  const setOpenState = (isOpen) => {
    setIsOpen(isOpen);
    onDropdownToggle(isOpen);
  };
  const dropdownRef = useClickOutside(isOpen, setOpenState);

  const toggleOpen = () => {
    setOpenState(!isOpen);
  };

  return html`
    <div
      className=${`form-dropdown ${className}`}
      hidden=${hidden}
      ref=${dropdownRef}
    >
      <i
        className=${`
          ${icon} form-dropdown-icon${isChanged ? " form-dropdown-icon-changed" : ""}
        `}
        onClick=${toggleOpen}
        title=${iconTitle}
      ></i>
      ${isOpen
        ? html`<div className="form-dropdown-content" onClick=${toggleOpen}>
            <div
              className="form-dropdown-content-inner"
              onClick=${(e) => e.stopPropagation()}
            >
              ${children}
            </div>
          </div>`
        : ""}
    </div>
  `;
};

// ================================================================================================
// Components
// ================================================================================================
const Submit = ({ submitName = "Submit", isFetching }) => html`
  <button
    type="submit"
    className="pure-button pure-button-primary ${(isFetching &&
      "pure-button-disabled") ||
    ""}"
  >
    ${submitName.startsWith("iconoir-")
      ? html`<i className=${submitName}></i>`
      : submitName}
  </button>
`;

export const QueryField = ({ placeholder = "Ask anything" }) => html`
  <fieldset>
    <textarea
      id="query"
      placeholder=${placeholder}
      className="pure-input-1"
      rows="3"
    ></textarea>
  </fieldset>
`;

export const PostTypeSelect = ({
  selected,
  setSelected,
  menuPlacement = "auto",
}) => html`
  <label htmlFor="postType" style=${{ whiteSpace: "nowrap" }}>
    <div className="form-multi-select">
      <${Select}
        id="postType"
        placeholder="Types..."
        isMulti=${true}
        menuPlacement=${menuPlacement}
        options=${POST_TYPE_OPTIONS}
        value=${selected}
        onChange=${setSelected}
      />
    </div>
  </label>
`;

export const PostTypeSelectDropdown = ({
  hidden,
  selected = [],
  setSelected,
}) => {
  const [hasChanged, setHasChanged] = useState(false);

  const handleTypeChange = (selectedOptions) => {
    setSelected(selectedOptions);
    setHasChanged(selectedOptions.length > 0);
  };

  return html`
    <${DropdownWrapper}
      icon="iconoir-multiple-pages"
      iconTitle="Post Types"
      isChanged=${hasChanged}
      hidden=${hidden}
    >
      <${PostTypeSelect}
        selected=${selected}
        setSelected=${handleTypeChange}
        menuPlacement="top"
      />
    </${DropdownWrapper}>
  `;
};

export const PostCategoryPrimarySelect = ({
  selected,
  setSelected,
  menuPlacement = "auto",
}) => html`
  <label htmlFor="categoryPrimary" style=${{ whiteSpace: "nowrap" }}>
    <div className="form-multi-select">
      <${Select}
        id="categoryPrimary"
        placeholder="Categories..."
        isMulti=${true}
        menuPlacement=${menuPlacement}
        options=${CATEGORY_OPTIONS}
        value=${selected}
        onChange=${setSelected}
      />
    </div>
  </label>
`;

export const PostCategoryPrimarySelectDropdown = ({
  hidden,
  selected = [],
  setSelected,
}) => {
  const [hasChanged, setHasChanged] = useState(false);

  const handleCategoryChange = (selectedOptions) => {
    setSelected(selectedOptions);
    setHasChanged(selectedOptions.length > 0);
  };

  return html`
    <${DropdownWrapper}
      icon="iconoir-list-select"
      iconTitle="Primary Categories"
      isChanged=${hasChanged}
      hidden=${hidden}
    >
      <${PostCategoryPrimarySelect}
        selected=${selected}
        setSelected=${handleCategoryChange}
        menuPlacement="top"
      />
    </${DropdownWrapper}>
  `;
};

// Note: Caller handles event.target.checked.
export const Checkbox = ({
  id,
  label,
  checked,
  onChange,
  title,
  children,
}) => html`
  <label className="pure-checkbox" ...${{ title }}>
    <input type="checkbox" id=${id} checked=${checked} onChange=${onChange} />
    <strong>${label}</strong>
    ${children ? html`: ${children}` : ""}
  </label>
`;

// Model select helpers.
const modelOptionsAreEqual = (a, b) =>
  a.provider === b.provider && a.model === b.model;

// react-select can't handle objects well, so translate under the hood.
const MODEL_OBJ_SEP = "::";
const modelObjToOption = ({ provider, model }) =>
  `${provider}${MODEL_OBJ_SEP}${model}`;
const optionToModelObj = (option) => {
  const [provider, model] = option.split(MODEL_OBJ_SEP);
  return { provider, model };
};

// TODO REMOVE -- used? titles?
// const modelStats = ({ pricing, maxTokens }) =>
//   `Max Input: ${maxTokens.toLocaleString("en-US")} tokens, Cost: $${pricing.input}/M in, $${pricing.output}/M out`;
const modelStats = () => "TODO: modelStats";

export const ModelChatSelect = ({
  selected,
  setSelected,
  defaultValue = DEFAULT_CHAT_MODEL,
  providers,
  menuPlacement = "auto",
}) => {
  const [settings] = useSettings();
  const { isDeveloperMode } = settings;

  const getLabel = (label, { provider, model }) => {
    // TODO(CHAT): REFACTOR
    return label;

    // if (!displayModelStats) {
    //   return label;
    // }

    // const inputPricing = CHAT_MODELS_MAP[provider][model].pricing.input;
    // return `${label} ($${inputPricing}/M)`;
  };

  let options = [];
  if (isDeveloperMode) {
    options = ALL_CHAT_MODELS.filter(({ provider }) =>
      providers.has(provider),
    ).map(({ provider, models }) => ({
      label: ALL_PROVIDERS[provider],
      options: models.map(({ model, pricing, maxTokens }) => ({
        id: `${provider}-${model}`,
        title: modelStats({ pricing, maxTokens }), // TODO REMOVE???
        label: getLabel(model, { provider, model }),
        value: modelObjToOption({ provider, model }),
      })),
    }));
  } else {
    const provider = "webLlm";
    options = [
      {
        label: "Fastest",
        model: "SmolLM2-360M-Instruct-q4f16_1-MLC",
      },
      {
        label: "Best",
        model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      },
      // TODO(CHAT): ADD MORE OR REMOVE
      // {
      //   label: "Best",
      //   model: "gpt-5.1",
      // },
    ].map(({ label, model }) => ({
      id: `${provider}-${model}`,
      label: getLabel(label, { provider, model }),
      value: modelObjToOption({ provider, model }),
    }));
  }

  // Manually set the selected state. (From doing object values).
  const isOptionSelected = ({ value }) => value === modelObjToOption(selected);
  const divClass = `form-multi-select-${isDeveloperMode ? "wide" : "medium"}`;

  return html`
    <label htmlFor="model" style=${{ whiteSpace: "nowrap" }}>
      <div className=${`form-multi-select ${divClass}`}>
        <${Select}
          id="model"
          title="LLM Model"
          placeholder="Model..."
          defaultValue=${modelObjToOption(defaultValue)}
          menuPlacement=${menuPlacement}
          options=${options}
          isOptionSelected=${isOptionSelected}
          value=${modelObjToOption(selected)}
          onChange=${({ value }) => setSelected(optionToModelObj(value))}
        />
      </div>
    </label>
  `;
};

export const ModelChatSelectDropdown = ({
  hidden,
  selected,
  setSelected,
  defaultValue = DEFAULT_CHAT_MODEL,
  providers,
}) => {
  const [hasChanged, setHasChanged] = useState(false);

  const handleModelChange = (modelObj) => {
    setSelected(modelObj);
    setHasChanged(!modelOptionsAreEqual(modelObj, defaultValue));
  };

  return html`
    <${DropdownWrapper}
      icon="iconoir-sparks"
      iconTitle="LLM Model (Chat)"
      isChanged=${hasChanged}
      hidden=${hidden}
    >
      <${ModelChatSelect}
        defaultValue=${defaultValue}
        selected=${selected}
        setSelected=${handleModelChange}
        providers=${providers}
      />
    </${DropdownWrapper}>
  `;
};

// TODO(LOCAL): Remove (or just don't use) datastore option?
// Datastore select helpers
const DATASTORE_OPTIONS = [
  {
    label: "Postgres",
    value: "postgresql",
    title: "PostgreSQL with pgvector on Neon", // TODO: Are titles used?
  },
  { label: "OpenAI Search", value: "openai", title: "OpenAI Vector Store" },
  {
    label: "OpenAI Tool",
    value: "openai-tool",
    title: "OpenAI File Search Tool",
  },
];

export const DatastoreSelect = ({
  hidden,
  selected,
  setSelected,
  defaultValue = DEFAULT_DATASTORE,
  menuPlacement = "auto",
  includeOpenAITool = true,
}) => {
  const [settings] = useSettings();

  // Create options array with conditional openai-tool option
  const options =
    includeOpenAITool && settings.featureOpenAIToolEnabled
      ? DATASTORE_OPTIONS
      : DATASTORE_OPTIONS.filter(({ value }) => value !== "openai-tool");

  return html`
    <label
      title="Select content datastore"
      hidden=${hidden}
      style=${{ whiteSpace: "nowrap" }}
    >
      <div className="form-multi-select">
        <${Select}
          id="datastore"
          placeholder="Datastore..."
          defaultValue=${defaultValue}
          menuPlacement=${menuPlacement}
          options=${options}
          isOptionSelected=${({ value }) => value === selected}
          value=${selected}
          onChange=${({ value }) => setSelected(value)}
        />
      </div>
    </label>
  `;
};

export const DatastoreSelectDropdown = ({
  hidden,
  selected,
  setSelected,
  defaultValue = DEFAULT_DATASTORE,
}) => {
  const [hasChanged, setHasChanged] = useState(false);

  const handleChange = (value) => {
    setSelected(value);
    setHasChanged(value !== defaultValue);
  };

  return html`
    <${DropdownWrapper}
      icon="iconoir-database"
      iconTitle="Datastore"
      isChanged=${hasChanged}
      hidden=${hidden}
    >
      <${DatastoreSelect}
        hidden=${hidden}
        defaultValue=${defaultValue}
        selected=${selected}
        setSelected=${handleChange}
        menuPlacement="top"
      />
    </${DropdownWrapper}>
  `;
};

// API select helpers
const API_OPTIONS = [
  {
    label: "Chat Completions",
    value: "chat",
    title: "Chat Completions",
  },
  {
    label: "Responses",
    value: "responses",
    title: "API Responses",
  },
];

export const ApiSelect = ({
  hidden,
  selected,
  setSelected,
  defaultValue = DEFAULT_API,
  menuPlacement = "auto",
}) => {
  return html`
    <label
      title="Select API type"
      hidden=${hidden}
      style=${{ whiteSpace: "nowrap" }}
    >
      <div className="form-multi-select form-multi-select-medium">
        <${Select}
          id="api"
          placeholder="API..."
          defaultValue=${defaultValue}
          menuPlacement=${menuPlacement}
          options=${API_OPTIONS}
          isOptionSelected=${({ value }) => value === selected}
          value=${selected}
          onChange=${({ value }) => setSelected(value)}
        />
      </div>
    </label>
  `;
};

export const ApiSelectDropdown = ({
  hidden,
  selected,
  setSelected,
  defaultValue = DEFAULT_API,
}) => {
  const [hasChanged, setHasChanged] = useState(false);

  const handleChange = (value) => {
    setSelected(value);
    setHasChanged(value !== defaultValue);
  };

  return html`
    <${DropdownWrapper}
      icon="iconoir-cloud-sync"
      iconTitle="API"
      isChanged=${hasChanged}
      hidden=${hidden}
    >
      <${ApiSelect}
        hidden=${hidden}
        defaultValue=${defaultValue}
        selected=${selected}
        setSelected=${handleChange}
        menuPlacement="top"
      />
    </${DropdownWrapper}>
  `;
};

const TEMPERATURE_TITLE =
  "Temperature. From 0 (more deterministic) to 1 (more random)";

// Raw temperature input (no dropdown logic)
export const Temperature = ({
  value,
  defaultValue = DEFAULT_TEMPERATURE,
  onChange,
  id = "temperature",
  min = 0,
  max = 1,
  step = 0.1,
  hidden = false,
}) => {
  return html`
    <label
      title=${TEMPERATURE_TITLE}
      className="form-dropdown-input-box"
      style=${{ whiteSpace: "nowrap" }}
      hidden=${hidden}
    >
      Temperature:${" "}<input
        id=${id}
        type="number"
        min=${min}
        max=${max}
        step=${step}
        defaultValue=${value || defaultValue}
        onChange=${(e) => onChange(parseFloat(getTargetValue(e)))}
      />
    </label>
  `;
};

// Wrapped temperature input with dropdown (for current usage)
export const TemperatureDropdown = ({
  hidden,
  value = DEFAULT_TEMPERATURE,
  onChange = () => {},
}) => {
  const [hasChanged, setHasChanged] = useState(false);

  const handleTemperatureChange = (value) => {
    setHasChanged(value !== DEFAULT_TEMPERATURE);
    onChange(value);
  };

  return html`
    <${DropdownWrapper}
      icon="iconoir-temperature-high"
      iconTitle=${TEMPERATURE_TITLE}
      className="form-dropdown-hideable"
      isChanged=${hasChanged}
      hidden=${hidden}
    >
      <${Temperature}
        value=${value}
        onChange=${handleTemperatureChange}
      />
    </${DropdownWrapper}>
  `;
};

const MIN_DATE_TITLE = "Filter to posts published on/before this date";

export const PostMinDate = ({ value, setValue, className }) => html`
  <label
    title=${MIN_DATE_TITLE}
    className=${className}
    style=${{ whiteSpace: "nowrap" }}
  >
    After:${" "}
    <input
      id="minDate"
      type="date"
      value=${value}
      onChange=${(e) => setValue(getTargetValue(e))}
    />
  </label>
`;

// Wrapped min date input with dropdown
export const PostMinDateDropdown = ({
  hidden,
  value = "",
  onChange = () => {},
}) => {
  const [hasChanged, setHasChanged] = useState(false);

  const handleChange = (value) => {
    setHasChanged(!!value);
    onChange(value);
  };

  return html`
    <${DropdownWrapper}
      icon="iconoir-calendar"
      iconTitle=${MIN_DATE_TITLE}
      isChanged=${hasChanged}
      hidden=${hidden}
    >
      <${PostMinDate} className="form-dropdown-input-box" value=${value} setValue=${handleChange}/>
    </${DropdownWrapper}>
  `;
};

// ================================================================================================
// Forms
// ================================================================================================
export const Form = ({
  handleSubmit,
  submitName = "Submit",
  isFetching,
  children,
}) => html`
  <form className="pure-form" onSubmit=${handleSubmit}>
    ${children}
    <${Submit} ...${{ submitName, isFetching }} />
  </form>
`;

export const ChatInputForm = (props) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  return html`
    <${ChatFormProvider} onDropdownToggle=${setIsDropdownOpen}>
      <div className="chat-input-container">
        <div className="chat-input-container-inner">
          <${Form} ...${props} />
          <div className=${isDropdownOpen ? "chat-input-overlay-mask" : ""}></div>
        </div>
      </div>
    </${ChatFormProvider}>
  `;
};

export { DownloadButton } from "./button.js";
export { DownloadMessage } from "./message.js";
import { RESOURCES } from "../../../data/downloads.js";

export const DOWNLOADS = Object.fromEntries(
  Object.entries(RESOURCES).map(([key, value]) => [key, value.id]),
);

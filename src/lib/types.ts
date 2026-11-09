/** The API key as the Settings page sees it (GET /api/settings). The key itself never leaves the server. */
export interface KeyStatus {
  env: string;
  vendor: string;
  url: string;
  required: boolean;
  purpose: string;
  set: boolean;
  /** Last 4 characters, so you can tell which key is saved. */
  hint: string | null;
}

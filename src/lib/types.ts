// Shared between the server (API routes) and the browser UI.

export const PROVIDER_IDS = ["chatgpt", "claude", "gemini"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
};

export interface Source {
  url: string;
  title: string;
  domain: string;
}

/** One answer from one assistant for one repetition of the query. */
export interface Answer {
  id: string; // e.g. "chatgpt-2"
  provider: ProviderId;
  run: number; // 1-based repetition number
  model: string; // the model that actually served the answer
  text?: string;
  sources: Source[];
  searchQueries: string[];
  error?: string;
  durationMs: number;
}

export interface Product {
  id: string;
  brand: string;
  name: string;
}

export type Stance = "recommended" | "mentioned" | "negative";

export interface Mention {
  answerId: string;
  productId: string;
  position: number; // 1 = first product named in that answer
  stance: Stance;
  quote: string;
}

export interface RunSettings {
  query: string;
  providers: ProviderId[];
  runsPerProvider: number;
  webSearch: boolean;
  country?: string; // ISO 3166-1 alpha-2, used to localise web search
  brand?: string; // the user's own brand, checked for in every answer
}

export interface Run {
  id: string;
  createdAt: string;
  settings: RunSettings;
  answers: Answer[];
  products: Product[];
  mentions: Mention[];
  analyzerModel?: string;
  analysisError?: string;
}

export interface RunSummary {
  id: string;
  createdAt: string;
  query: string;
  brand?: string;
  providers: ProviderId[];
  answerCount: number;
  productCount: number;
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  model: string;
  configured: boolean;
  envKey: string;
}

export interface AppConfig {
  providers: ProviderStatus[];
  analyzer: { model: string; configured: boolean };
}

/** Events streamed (as NDJSON) from POST /api/runs while a run is in progress. */
export type RunEvent =
  | { type: "started"; runId: string; jobs: { answerId: string; provider: ProviderId; run: number }[] }
  | { type: "answer"; answer: Answer }
  | { type: "analyzing" }
  | { type: "done"; run: Run }
  | { type: "error"; message: string };

/** One API key as the Settings page sees it (GET /api/settings). The key itself never leaves the server. */
export interface KeyStatus {
  env: string;
  vendor: string;
  assistant: string;
  provider: ProviderId;
  url: string;
  required: boolean;
  purpose: string;
  set: boolean;
  /** Last 4 characters, so you can tell which key is saved. */
  hint: string | null;
}

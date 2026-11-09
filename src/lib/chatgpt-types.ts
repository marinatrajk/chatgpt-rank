// The ChatGPT app check: shared between the server (API routes) and the browser UI.
// CheckResult and CheckReport mirror what gpt-checker writes (gpt-checker/src/report.ts); this app only reads them.

export interface CheckResult {
  timestamp: string;
  brand: string;
  query: string;
  status: "ok" | "error" | "stopped" | "skipped";
  mentioned: boolean | null;
  variant: string | null;
  matchedText: string | null;
  matchKind: "exact" | "spelling" | "fuzzy" | null;
  position: number | null;
  line: number | null;
  lines: number | null;
  sentence: string | null;
  mentions: number;
  inAd: boolean;
  citations: string[];
  model: string | null;
  durationS: number | null;
  transcript: string | null; // relative to gpt-checker/data
  screenshot: string | null;
  error: string | null;
}

export interface CheckReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  loggedIn: boolean;
  freshSessions?: boolean;
  stoppedEarly: string | null;
  results: CheckResult[];
}

export interface CheckSummary {
  runId: string;
  startedAt: string;
  brands: string[];
  mentioned: number;
  answered: number;
  total: number;
  stoppedEarly: string | null;
}

export interface QuerySuggestion {
  brand: string;
  variants: string[]; // other names that count as a mention
  category: string; // what the brand sells, in a few words
  queries: string[];
}

export interface CheckRequest {
  brand: string;
  variants: string[];
  queries: string[];
}

/** Streamed (as NDJSON) from POST /api/chatgpt/runs while a check runs. */
export type CheckEvent =
  | { type: "started"; runId: string; total: number; loggedIn: boolean; freshSessions: boolean }
  | { type: "query"; index: number; running?: boolean; result?: CheckResult }
  | { type: "finished"; runId: string; stoppedEarly: string | null }
  | { type: "report"; report: CheckReport }
  | { type: "error"; message: string };

export const MAX_CHECK_QUERIES = 10; // gpt-checker's limit per run
export const VIEWER_URL = "http://localhost:6080/vnc.html?autoconnect=1&resize=scale";

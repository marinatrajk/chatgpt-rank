// Run reports (JSON + CSV), the history.csv every run appends to, and summary.md with the trend.

import fs from "node:fs/promises";
import path from "node:path";
import type { MatchKind } from "./match";

export interface Result {
  timestamp: string;
  brand: string;
  query: string;
  status: "ok" | "error" | "stopped" | "skipped"; // stopped: hit a wall; skipped: not reached after a wall
  mentioned: boolean | null; // in the answer itself (ads don't count)
  variant: string | null; // the name from pairs.json that matched first
  matchedText: string | null; // as written in the answer
  matchKind: MatchKind | null;
  position: number | null; // character position of the first match
  line: number | null; // line of the first match …
  lines: number | null; // … out of this many
  sentence: string | null;
  mentions: number;
  inAd: boolean; // named in an ad shown with the answer
  citations: string[]; // source pills and links in the answer
  model: string | null;
  durationS: number | null;
  transcript: string | null; // relative to the data folder
  screenshot: string | null;
  error: string | null;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  loggedIn: boolean;
  freshSessions: boolean; // ChatGPT's cookies, storage and cache were cleared before each query
  stoppedEarly: string | null;
  results: Result[];
}

const COLUMNS: [string, (r: Result, run: RunReport) => string | number | boolean | null][] = [
  ["run_id", (_, run) => run.runId],
  ["timestamp", (r) => r.timestamp],
  ["brand", (r) => r.brand],
  ["query", (r) => r.query],
  ["status", (r) => r.status],
  ["mentioned", (r) => (r.mentioned === null ? "" : r.mentioned ? "yes" : "no")],
  ["variant_matched", (r) => r.variant],
  ["matched_text", (r) => r.matchedText],
  ["match_kind", (r) => r.matchKind],
  ["position", (r) => r.position],
  ["line", (r) => r.line],
  ["lines", (r) => r.lines],
  ["sentence", (r) => r.sentence],
  ["mentions", (r) => r.mentions],
  ["in_ad", (r) => (r.status === "ok" ? (r.inAd ? "yes" : "no") : "")],
  ["citations", (r) => r.citations.join(" | ")],
  ["logged_in", (_, run) => (run.loggedIn ? "yes" : "no")],
  ["model", (r) => r.model],
  ["duration_s", (r) => r.durationS],
  ["transcript", (r) => r.transcript],
  ["screenshot", (r) => r.screenshot],
  ["error", (r) => r.error],
];

function csvCell(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvRow = (cells: (string | number | boolean | null)[]) => cells.map(csvCell).join(",");
const csvRows = (run: RunReport) => run.results.map((r) => csvRow(COLUMNS.map(([, get]) => get(r, run))));
const HEADER = csvRow(COLUMNS.map(([name]) => name));

/** Parses CSV written by csvRow (quoted cells may contain commas, quotes and newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export async function writeRunReport(reportsDir: string, run: RunReport): Promise<void> {
  await fs.mkdir(reportsDir, { recursive: true });
  const base = path.join(reportsDir, `report-${run.runId}`);
  await fs.writeFile(`${base}.json`, JSON.stringify(run, null, 2) + "\n");
  await fs.writeFile(`${base}.csv`, [HEADER, ...csvRows(run)].join("\n") + "\n");
}

export async function appendHistory(historyFile: string, run: RunReport): Promise<void> {
  const exists = await fs.access(historyFile).then(
    () => true,
    () => false,
  );
  await fs.appendFile(historyFile, [...(exists ? [] : [HEADER]), ...csvRows(run)].join("\n") + "\n");
}

/** One line per pair: brand, query, YES / NO / what went wrong. */
export function summaryTable(run: RunReport): string {
  const label = (r: Result) =>
    r.status !== "ok" ? r.status.toUpperCase() : r.mentioned ? `YES (line ${r.line}/${r.lines})` : r.inAd ? "NO (ad only)" : "NO";
  const left = run.results.map((r) => `${r.brand} · ${r.query}`);
  const width = Math.min(70, Math.max(...left.map((l) => l.length), 10));
  const lines = run.results.map((r, i) => `${left[i].slice(0, width).padEnd(width)}  ${label(r)}`);
  const ok = run.results.filter((r) => r.status === "ok");
  const yes = ok.filter((r) => r.mentioned).length;
  return [...lines, "", `Mentioned in ${yes} of ${ok.length} answers.${run.stoppedEarly ? ` Stopped early: ${run.stoppedEarly}` : ""}`].join("\n");
}

const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/**
 * summary.md: for each pair in the latest run, its result next to the previous run's, the trend,
 * and how often it was mentioned across every run in history.csv.
 */
export function buildSummary(history: Record<string, string>[]): string {
  const runIds = [...new Set(history.map((h) => h.run_id))].sort();
  const latestId = runIds.at(-1);
  if (!latestId) return "# ChatGPT brand mentions\n\nNo runs yet.\n";
  const latest = history.filter((h) => h.run_id === latestId);
  const key = (h: Record<string, string>) => `${h.brand.toLowerCase()}\n${h.query.toLowerCase()}`;
  const answered = (h: Record<string, string>) => h.status === "ok";

  const rows = latest.map((h) => {
    const past = history.filter((p) => key(p) === key(h) && answered(p) && p.run_id < latestId);
    const prev = past.at(-1);
    const all = history.filter((p) => key(p) === key(h) && answered(p));
    const yesCount = all.filter((p) => p.mentioned === "yes").length;
    const now = !answered(h) ? h.status : h.mentioned === "yes" ? `**yes** (line ${h.line} of ${h.lines})` : "no";
    const before = prev ? (prev.mentioned === "yes" ? "yes" : "no") : "–";
    let trend = "first run";
    if (!answered(h)) trend = "–";
    else if (prev && prev.mentioned !== h.mentioned) trend = h.mentioned === "yes" ? "▲ newly mentioned" : "▼ dropped";
    else if (prev) trend = h.mentioned === "yes" ? "= still mentioned" : "= still missing";
    return `| ${mdCell(h.brand)} | ${mdCell(h.query)} | ${now} | ${before} | ${trend} | ${yesCount} of ${all.length} |`;
  });

  const ok = latest.filter(answered);
  const yes = ok.filter((h) => h.mentioned === "yes").length;
  return [
    "# ChatGPT brand mentions",
    "",
    `Latest run ${latestId} (${latest[0]?.logged_in === "yes" ? "logged in" : "logged out"}): mentioned in **${yes} of ${ok.length}** answers. ${runIds.length} run${runIds.length === 1 ? "" : "s"} in history.`,
    "",
    "| Brand | Query | Latest | Previous run | Trend | Mentioned across runs |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

export async function writeSummary(historyFile: string, summaryFile: string): Promise<void> {
  const text = await fs.readFile(historyFile, "utf8").catch(() => "");
  await fs.writeFile(summaryFile, buildSummary(text ? parseCsv(text) : []));
}

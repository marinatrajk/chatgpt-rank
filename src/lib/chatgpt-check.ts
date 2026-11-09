// Runs gpt-checker (the Docker + Playwright runner in gpt-checker/) for the web app, and reads its reports.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { CheckEvent, CheckReport, CheckRequest, CheckSummary } from "./chatgpt-types";

const CHECKER_DIR = path.resolve("gpt-checker");
const DATA_DIR = path.join(CHECKER_DIR, "data");
const REPORTS_DIR = path.join(DATA_DIR, "reports");
const RUN_ID = /^\d{8}-\d{6}$/;
const TRANSCRIPT = /^transcripts\/[\w.-]+\.md$/;

// One check at a time from this app; gpt-checker's own lock also stops runs started elsewhere.
let running = false;

export function isCheckRunning(): boolean {
  return running;
}

/** Turns docker's stderr into one readable sentence. */
function explainFailure(stderr: string, code: number | null): string {
  if (/port is already allocated/i.test(stderr)) {
    return "Another ChatGPT check is already running (its viewer holds port 6080). Wait for it to finish.";
  }
  if (/cannot connect to the docker daemon|docker daemon is not running|error during connect/i.test(stderr)) {
    return "Docker isn't running. Start Docker Desktop and try again.";
  }
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^Container \S+ (Creating|Created|Starting|Started)/.test(l) && !l.startsWith("npm notice"));
  return lines.at(-1) ?? `gpt-checker stopped with exit code ${code}`;
}

/**
 * Writes the queries as a gpt-checker pairs file and runs one check in Docker, passing its progress
 * events on. Ends with a "report" event, or throws with what went wrong.
 */
export async function runCheck(request: CheckRequest, emit: (e: CheckEvent) => void): Promise<void> {
  if (running) throw new Error("A ChatGPT check is already running. Wait for it to finish.");
  running = true;
  const pairsName = `ui-pairs-${Date.now()}.json`;
  const pairsFile = path.join(DATA_DIR, pairsName);
  try {
    const pairs = request.queries.map((query) => ({ brand: request.brand, variants: request.variants, query }));
    await fs.writeFile(pairsFile, JSON.stringify(pairs, null, 2));

    const child = spawn(
      "docker",
      ["compose", "run", "--rm", "-T", "--service-ports", "gpt-checker", "npm", "run", "check", "--", "--pairs", `data/${pairsName}`, "--events"],
      { cwd: CHECKER_DIR },
    );
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-8000);
    });
    let runId: string | null = null;
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.startsWith("@event ")) return; // the human-readable log
      try {
        const event = JSON.parse(line.slice("@event ".length)) as CheckEvent;
        if (event.type === "started" || event.type === "finished") runId = event.runId;
        emit(event);
      } catch {
        // a malformed line; the report at the end is what counts
      }
    });

    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", (err: NodeJS.ErrnoException) =>
        reject(err.code === "ENOENT" ? new Error("Docker isn't installed: the docker command wasn't found.") : err),
      );
      child.on("close", resolve);
    });

    const report = runId ? await getReport(runId) : null;
    if (!report) throw new Error(explainFailure(stderr, code));
    emit({ type: "report", report });
  } finally {
    running = false;
    await fs.rm(pairsFile, { force: true });
  }
}

export async function getReport(runId: string): Promise<CheckReport | null> {
  if (!RUN_ID.test(runId)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(REPORTS_DIR, `report-${runId}.json`), "utf8")) as CheckReport;
  } catch {
    return null;
  }
}

export async function listReports(): Promise<CheckSummary[]> {
  let files: string[];
  try {
    files = await fs.readdir(REPORTS_DIR);
  } catch {
    return [];
  }
  const ids = files.map((f) => f.match(/^report-(\d{8}-\d{6})\.json$/)?.[1]).filter((id): id is string => Boolean(id));
  const reports = await Promise.all(ids.map(getReport));
  return reports
    .filter((r): r is CheckReport => r !== null)
    .map((r) => {
      const answered = r.results.filter((x) => x.status === "ok");
      return {
        runId: r.runId,
        startedAt: r.startedAt,
        brands: [...new Set(r.results.map((x) => x.brand))],
        mentioned: answered.filter((x) => x.mentioned).length,
        answered: answered.length,
        total: r.results.length,
        stoppedEarly: r.stoppedEarly,
      };
    })
    .sort((a, b) => b.runId.localeCompare(a.runId));
}

/** A saved answer, by the path a report gives (e.g. "transcripts/20261109-143216-01-best-….md"). */
export async function getTranscript(file: string): Promise<string | null> {
  if (!TRANSCRIPT.test(file)) return null;
  return fs.readFile(path.join(DATA_DIR, file), "utf8").catch(() => null);
}

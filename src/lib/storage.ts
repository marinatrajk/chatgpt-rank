import { promises as fs } from "node:fs";
import path from "node:path";
import type { Run, RunSummary } from "./types";

const RUNS_DIR = path.join(process.cwd(), "data", "runs");
const ID_PATTERN = /^[a-z0-9-]+$/;

function runPath(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error("Invalid run id");
  return path.join(RUNS_DIR, `${id}.json`);
}

export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
}

export async function saveRun(run: Run): Promise<void> {
  await fs.mkdir(RUNS_DIR, { recursive: true });
  await fs.writeFile(runPath(run.id), JSON.stringify(run, null, 2));
}

export async function getRun(id: string): Promise<Run | null> {
  try {
    return JSON.parse(await fs.readFile(runPath(id), "utf8")) as Run;
  } catch {
    return null;
  }
}

export async function deleteRun(id: string): Promise<void> {
  await fs.rm(runPath(id), { force: true });
}

export async function listRuns(): Promise<RunSummary[]> {
  let files: string[];
  try {
    files = await fs.readdir(RUNS_DIR);
  } catch {
    return [];
  }
  const runs = await Promise.all(
    files.filter((f) => f.endsWith(".json")).map((f) => getRun(f.slice(0, -5))),
  );
  return runs
    .filter((r): r is Run => r !== null)
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      query: r.settings.query,
      brand: r.settings.brand,
      providers: r.settings.providers,
      answerCount: r.answers.filter((a) => a.text).length,
      productCount: r.products.length,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

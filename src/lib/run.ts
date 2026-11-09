import { analyzeAnswers, analyzerModel } from "./analyze";
import { ask, providerModel } from "./providers";
import { newRunId, saveRun } from "./storage";
import type { Answer, ProviderId, Run, RunEvent, RunSettings } from "./types";

// How many assistant calls run at once across all providers.
const CONCURRENCY = 6;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** SDK errors often carry the vendor's JSON body in the message; pull out the readable part. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const brace = msg.indexOf("{");
  if (brace === -1) return msg;
  try {
    const body = JSON.parse(msg.slice(brace));
    const inner = body?.error?.message ?? body?.message;
    if (typeof inner === "string") {
      const status = msg.match(/^\d{3}\b/)?.[0];
      return status ? `${status} ${inner}` : inner;
    }
  } catch {
    // not JSON after all
  }
  return msg;
}

export async function executeRun(settings: RunSettings, emit: (e: RunEvent) => void): Promise<Run> {
  const runId = newRunId();
  const jobs: { answerId: string; provider: ProviderId; run: number }[] = [];
  for (let r = 1; r <= settings.runsPerProvider; r++) {
    for (const provider of settings.providers) {
      jobs.push({ answerId: `${provider}-${r}`, provider, run: r });
    }
  }
  emit({ type: "started", runId, jobs });

  const answers = await mapLimit(jobs, CONCURRENCY, async (job): Promise<Answer> => {
    const started = Date.now();
    let answer: Answer;
    try {
      const res = await ask(job.provider, settings.query, {
        webSearch: settings.webSearch,
        country: settings.country,
      });
      answer = { id: job.answerId, provider: job.provider, run: job.run, ...res, durationMs: Date.now() - started };
    } catch (err) {
      answer = {
        id: job.answerId,
        provider: job.provider,
        run: job.run,
        model: providerModel(job.provider),
        sources: [],
        searchQueries: [],
        error: errorMessage(err),
        durationMs: Date.now() - started,
      };
    }
    emit({ type: "answer", answer });
    return answer;
  });

  const run: Run = {
    id: runId,
    createdAt: new Date().toISOString(),
    settings,
    answers,
    products: [],
    mentions: [],
  };

  // A run where every request failed isn't worth keeping in history.
  if (answers.some((a) => a.text)) {
    emit({ type: "analyzing" });
    run.analyzerModel = analyzerModel();
    try {
      Object.assign(run, await analyzeAnswers(settings.query, answers));
    } catch (err) {
      run.analysisError = errorMessage(err);
    }
    await saveRun(run);
  }

  emit({ type: "done", run });
  return run;
}

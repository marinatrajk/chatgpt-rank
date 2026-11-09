"use client";

import { PROVIDER_LABELS, type Answer, type ProviderId } from "@/lib/types";

export interface Job {
  answerId: string;
  provider: ProviderId;
  run: number;
}

interface Props {
  jobs: Job[];
  answers: Answer[];
  analyzing: boolean;
}

export function Progress({ jobs, answers, analyzing }: Props) {
  const byId = new Map(answers.map((a) => [a.id, a]));
  return (
    <div className="progress" aria-live="polite">
      {jobs.map((job) => {
        const a = byId.get(job.answerId);
        const state = !a ? "pending" : a.error ? "error" : "done";
        return (
          <span key={job.answerId} className={`chip ${state}`} title={a?.error}>
            {state === "pending" ? <span className="spinner" /> : <span className={`dot ${job.provider}`} />}
            {PROVIDER_LABELS[job.provider]} #{job.run}
            {state === "done" && ` · ${(a!.durationMs / 1000).toFixed(0)}s`}
            {state === "error" && " · failed"}
          </span>
        );
      })}
      {analyzing && (
        <span className="chip">
          <span className="spinner" /> Extracting products…
        </span>
      )}
    </div>
  );
}

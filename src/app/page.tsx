"use client";

import { useCallback, useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { History } from "@/components/History";
import { Progress, type Job } from "@/components/Progress";
import { Results } from "@/components/Results";
import { RunForm } from "@/components/RunForm";
import type { AppConfig, Run, RunEvent, RunSettings, RunSummary } from "@/lib/types";

type Phase = "idle" | "running" | "analyzing" | "done";

export default function Home() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    const res = await fetch("/api/runs");
    if (res.ok) setHistory(await res.json());
  }, []);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setError("Couldn't reach the local server."));
    refreshHistory();
  }, [refreshHistory]);

  const busy = phase === "running" || phase === "analyzing";

  const handleEvent = (settings: RunSettings, event: RunEvent) => {
    switch (event.type) {
      case "started":
        setJobs(event.jobs);
        setRun({
          id: event.runId,
          createdAt: new Date().toISOString(),
          settings,
          answers: [],
          products: [],
          mentions: [],
        });
        break;
      case "answer":
        setRun((prev) => prev && { ...prev, answers: [...prev.answers, event.answer] });
        break;
      case "analyzing":
        setPhase("analyzing");
        break;
      case "done":
        setRun(event.run);
        setPhase("done");
        break;
      case "error":
        setError(event.message);
        break;
    }
  };

  const startRun = async (settings: RunSettings) => {
    setError(null);
    setRun(null);
    setJobs([]);
    setPhase("running");
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) handleEvent(settings, JSON.parse(line) as RunEvent);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase((p) => (p === "done" ? p : "idle"));
      refreshHistory();
    }
  };

  const openRun = async (id: string) => {
    if (busy) return;
    const res = await fetch(`/api/runs/${id}`);
    if (!res.ok) return setError("That run could not be loaded.");
    setError(null);
    setJobs([]);
    setRun(await res.json());
    setPhase("done");
  };

  const removeRun = async (id: string) => {
    await fetch(`/api/runs/${id}`, { method: "DELETE" });
    if (run?.id === id && !busy) {
      setRun(null);
      setPhase("idle");
    }
    refreshHistory();
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brandmark">GEO Tool</div>
        <AppNav />
        <History runs={history} activeId={run?.id ?? null} onOpen={openRun} onDelete={removeRun} />
      </aside>

      <main className="main">
        <RunForm config={config} busy={busy} onRun={startRun} />

        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {busy && <Progress jobs={jobs} answers={run?.answers ?? []} analyzing={phase === "analyzing"} />}

        {run && phase !== "idle" && <Results key={run.id} run={run} phase={phase} />}

        {!run && !busy && (
          <div className="card placeholder">
            Ask a question the way a shopper would. Each assistant answers it a few times (answers vary), then Claude
            pulls out every product so you can see who gets recommended, how often, and how high.
          </div>
        )}
      </main>
    </div>
  );
}

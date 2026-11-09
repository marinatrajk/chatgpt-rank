"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { CheckReportView, YesNo } from "@/components/CheckReportView";
import {
  MAX_CHECK_QUERIES,
  VIEWER_URL,
  type CheckEvent,
  type CheckReport,
  type CheckResult,
  type CheckSummary,
  type QuerySuggestion,
} from "@/lib/chatgpt-types";

interface Query {
  id: number;
  text: string;
}

interface Progress {
  results: (CheckResult | null)[];
  running: number | null;
  started: boolean; // gpt-checker has opened ChatGPT
  loggedIn?: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ChatGPTCheckPage() {
  const [history, setHistory] = useState<CheckSummary[]>([]);
  const [input, setInput] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [brand, setBrand] = useState("");
  const [variants, setVariants] = useState("");
  const [queries, setQueries] = useState<Query[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(0);

  const refreshHistory = useCallback(async () => {
    const res = await fetch("/api/chatgpt/runs");
    if (res.ok) setHistory(await res.json());
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const toQueries = (texts: string[]) => texts.map((text) => ({ id: nextId.current++, text }));

  const suggest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || suggesting || running) return;
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch("/api/chatgpt/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      const s = body as QuerySuggestion;
      setBrand(s.brand);
      setVariants(s.variants.join(", "));
      setQueries(toQueries(s.queries));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  };

  const texts = queries.map((q) => q.text.trim()).filter((t) => t.length >= 3);
  const canRun = !running && brand.trim().length > 0 && texts.length > 0;

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setReport(null);
    setProgress({ results: texts.map(() => null), running: null, started: false });
    try {
      const res = await fetch("/api/chatgpt/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: brand.trim(),
          variants: variants
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          queries: texts,
        }),
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
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) handleEvent(JSON.parse(line) as CheckEvent);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      refreshHistory();
    }
  };

  const handleEvent = (event: CheckEvent) => {
    if (event.type === "started") {
      setProgress((p) => p && { ...p, started: true, loggedIn: event.loggedIn });
    } else if (event.type === "query") {
      setProgress((p) => {
        if (!p) return p;
        if (event.running) return { ...p, running: event.index };
        const results = [...p.results];
        if (event.result) results[event.index] = event.result;
        return { ...p, results, running: null };
      });
    } else if (event.type === "report") {
      setReport(event.report);
    } else if (event.type === "error") {
      setError(event.message);
    }
  };

  const openRun = async (runId: string) => {
    if (running) return;
    const res = await fetch(`/api/chatgpt/runs/${runId}`);
    if (!res.ok) return;
    setProgress(null);
    setError(null);
    setReport(await res.json());
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brandmark">GEO Tool</div>
        <AppNav />
        {history.length > 0 && (
          <>
            <h2>Past checks</h2>
            <ul className="history">
            {history.map((h) => (
              <li key={h.runId} className={h.runId === report?.runId ? "active" : undefined}>
                <button className="open" onClick={() => openRun(h.runId)} disabled={running}>
                  <span className="q">{h.brands.join(", ")}</span>
                  <span className="meta">
                    {formatDate(h.startedAt)} · {h.mentioned}/{h.answered}
                    {h.stoppedEarly ? " · stopped early" : ""}
                  </span>
                </button>
              </li>
            ))}
            </ul>
          </>
        )}
      </aside>

      <main className="main">
        <form className="card form" onSubmit={suggest}>
          <div className="query-row">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Brand or website"
              aria-label="Brand or website"
              autoFocus
              disabled={running}
            />
            <button className="btn" type="submit" disabled={!input.trim() || suggesting || running}>
              {suggesting ? "Writing queries…" : "Suggest queries"}
            </button>
          </div>
        </form>

        {queries.length > 0 && (
          <div className="card form">
            <div className="setup-row">
              <label className="field-block">
                Brand
                <input value={brand} onChange={(e) => setBrand(e.target.value)} disabled={running} />
              </label>
              <label className="field-block grow">
                Also counts as
                <input
                  value={variants}
                  onChange={(e) => setVariants(e.target.value)}
                  placeholder="Other names, comma-separated"
                  disabled={running}
                />
              </label>
            </div>

            <ol className="query-edit">
              {queries.map((q, i) => (
                <li key={q.id}>
                  <span className="n">{i + 1}</span>
                  <input
                    value={q.text}
                    onChange={(e) => setQueries((qs) => qs.map((x) => (x.id === q.id ? { ...x, text: e.target.value } : x)))}
                    aria-label={`Query ${i + 1}`}
                    disabled={running}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove query ${i + 1}`}
                    onClick={() => setQueries((qs) => qs.filter((x) => x.id !== q.id))}
                    disabled={running}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>

            <div className="setup-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setQueries((qs) => [...qs, ...toQueries([""])])}
                disabled={running || queries.length >= MAX_CHECK_QUERIES}
              >
                Add a query
              </button>
              <button type="button" className="btn" onClick={run} disabled={!canRun}>
                {running ? "Running…" : "Run in ChatGPT"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {running && progress && (
          <div className="card form">
            <p className="progress-head">
              {progress.started ? "Running" : "Starting"}{" "}
              <a href={VIEWER_URL} target="_blank" rel="noreferrer">
                Watch live
              </a>
            </p>
            <ul className="progress-list">
              {texts.map((text, i) => {
                const result = progress.results[i];
                return (
                  <li key={i}>
                    <span className="status">
                      {result ? (
                        <YesNo result={result} />
                      ) : progress.running === i ? (
                        <span className="spinner" aria-label="Asking" />
                      ) : (
                        <span className="yesno other">waiting</span>
                      )}
                    </span>
                    <span className="text">
                      {text}
                      {result?.sentence && <span className="said"> “{result.sentence}”</span>}
                      {result?.error && <span className="said error"> {result.error}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {report && <CheckReportView key={report.runId} report={report} />}
      </main>
    </div>
  );
}

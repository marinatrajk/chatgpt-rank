"use client";

import Link from "next/link";
import { useState } from "react";
import type { AppConfig, ProviderId, RunSettings } from "@/lib/types";

const COUNTRIES: [string, string][] = [
  ["", "Any country"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["NL", "Netherlands"],
  ["IN", "India"],
];

interface Props {
  config: AppConfig | null;
  busy: boolean;
  onRun: (settings: RunSettings) => void;
}

export function RunForm({ config, busy, onRun }: Props) {
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [unchecked, setUnchecked] = useState<Set<ProviderId>>(new Set());
  const [runsPerProvider, setRunsPerProvider] = useState(3);
  const [webSearch, setWebSearch] = useState(true);
  const [country, setCountry] = useState("US");

  const providers = config?.providers ?? [];
  const selected = providers.filter((p) => p.configured && !unchecked.has(p.id)).map((p) => p.id);
  const missing = providers.filter((p) => !p.configured);
  const canRun = !busy && query.trim().length >= 3 && selected.length > 0 && Boolean(config?.analyzer.configured);

  const toggle = (id: ProviderId) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRun) return;
    onRun({
      query: query.trim(),
      providers: selected,
      runsPerProvider,
      webSearch,
      ...(webSearch && country ? { country } : {}),
      ...(brand.trim() ? { brand: brand.trim() } : {}),
    });
  };

  return (
    <form className="card form" onSubmit={submit}>
      <div className="query-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a shopper's question, e.g. best shampoo for hair loss"
          aria-label="Query"
          autoFocus
        />
        <input
          className="brand-input"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Your brand, e.g. K18"
          aria-label="Your brand"
          maxLength={80}
        />
        <button className="btn" type="submit" disabled={!canRun}>
          {busy ? "Running…" : "Ask the AIs"}
        </button>
      </div>

      <div className="options">
        {providers.map((p) => (
          <label
            key={p.id}
            className={`provider-toggle${p.configured ? "" : " disabled"}`}
            title={p.configured ? p.model : "Add its API key in Settings to turn it on"}
          >
            <input
              type="checkbox"
              checked={p.configured && !unchecked.has(p.id)}
              disabled={!p.configured || busy}
              onChange={() => toggle(p.id)}
            />
            <span className={`dot ${p.id}`} />
            {p.label}
            <span className="model">{p.model}</span>
          </label>
        ))}

        <span className="divider" />

        <label className="field">
          Runs each
          <select
            value={runsPerProvider}
            onChange={(e) => setRunsPerProvider(Number(e.target.value))}
            disabled={busy}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} disabled={busy} />
          Web search
        </label>

        <label className="field">
          Country
          <select value={country} onChange={(e) => setCountry(e.target.value)} disabled={busy || !webSearch}>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {config && config.analyzer.configured && missing.length > 0 && (
        <div className="notice">
          Off: {missing.map((p) => p.label).join(", ")}. To turn {missing.length > 1 ? "them" : "it"} on, add{" "}
          {missing.length > 1 ? "their keys" : "its key"} in <Link href="/settings">Settings</Link>.
        </div>
      )}
      {config && !config.analyzer.configured && (
        <div className="notice error">
          Add your Claude API key in <Link href="/settings">Settings</Link> to start. It&apos;s required: Claude reads
          every answer and pulls out the products.
        </div>
      )}
    </form>
  );
}

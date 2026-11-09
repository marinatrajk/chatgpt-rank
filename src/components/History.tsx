"use client";

import { PROVIDER_LABELS, type RunSummary } from "@/lib/types";

interface Props {
  runs: RunSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function History({ runs, activeId, onOpen, onDelete }: Props) {
  return (
    <>
      <h2>Past runs</h2>
      {runs.length === 0 ? (
        <p className="empty-note">Runs you make are saved here.</p>
      ) : (
        <ul className="history">
          {runs.map((r) => (
            <li key={r.id} className={r.id === activeId ? "active" : undefined}>
              <button className="open" onClick={() => onOpen(r.id)} title={r.query}>
                <span className="q">{r.query}</span>
                <span className="meta">
                  {r.brand && <strong>{r.brand} · </strong>}
                  {formatDate(r.createdAt)} · {r.providers.map((p) => PROVIDER_LABELS[p]).join(", ")} ·{" "}
                  {r.productCount} products
                </span>
              </button>
              <button
                className="delete"
                aria-label={`Delete run "${r.query}"`}
                onClick={() => {
                  if (confirm(`Delete the run for "${r.query}"?`)) onDelete(r.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

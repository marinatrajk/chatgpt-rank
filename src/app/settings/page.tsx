"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import type { KeyStatus } from "@/lib/types";

interface RowState {
  draft: string;
  saving: boolean;
  error?: string;
  note?: string;
}

export default function Settings() {
  const [keys, setKeys] = useState<KeyStatus[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setKeys)
      .catch(() => setLoadError("Couldn't reach the local server."));
  }, []);

  const row = (env: string): RowState => rows[env] ?? { draft: "", saving: false };
  const patch = (env: string, next: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [env]: { ...(prev[env] ?? { draft: "", saving: false }), ...next } }));

  const save = async (key: KeyStatus, value: string) => {
    patch(key.env, { saving: true, error: undefined, note: undefined });
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env: key.env, value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setKeys(body.keys);
      patch(key.env, {
        saving: false,
        draft: "",
        note: body.warning ?? (value ? `Saved. ${key.assistant} is on.` : `Removed. ${key.assistant} is off.`),
      });
    } catch (err) {
      patch(key.env, { saving: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const ready = keys?.some((k) => k.required && k.set) ?? false;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brandmark">GEO Tool</div>
        <AppNav />
      </aside>

      <main className="main settings">
        <h1>Settings</h1>
        <p className="lede">
          Paste an API key for each assistant you want to check. Keys are saved in <code>.env.local</code> on this
          computer and sent only to that vendor. Each answer is one paid API call on your account.
        </p>

        {loadError && <div className="notice error">{loadError}</div>}

        {keys && (
          <div className={`notice${ready ? " ready" : ""}`}>
            {ready ? (
              <>
                You&apos;re set. <Link href="/">Compare assistants</Link> or{" "}
                <Link href="/chatgpt">check a brand in ChatGPT</Link>.
              </>
            ) : (
              <>Start with the Claude key: it&apos;s required, because Claude reads every answer and pulls out the products.</>
            )}
          </div>
        )}

        {keys?.map((key) => {
          const r = row(key.env);
          return (
            <section key={key.env} className="card key-card">
              <div className="key-head">
                <span className={`dot ${key.provider}`} />
                <strong>{key.assistant}</strong>
                <span className="vendor">{key.vendor}</span>
                {key.set ? (
                  <span className="key-pill on">Saved {key.hint}</span>
                ) : (
                  <span className={`key-pill${key.required ? " required" : ""}`}>
                    {key.required ? "Required" : "Not set"}
                  </span>
                )}
              </div>
              <p className="key-purpose">
                {key.purpose}{" "}
                <a href={key.url} target="_blank" rel="noreferrer">
                  Get a key from {key.vendor} ↗
                </a>
              </p>
              <form
                className="key-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (r.draft.trim()) save(key, r.draft);
                }}
              >
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={key.set ? `Paste a new key to replace ${key.hint}` : `Paste your ${key.vendor} API key`}
                  value={r.draft}
                  onChange={(e) => patch(key.env, { draft: e.target.value, error: undefined, note: undefined })}
                  disabled={r.saving}
                  aria-label={`${key.assistant} API key`}
                />
                <button className="btn" type="submit" disabled={r.saving || !r.draft.trim()}>
                  {r.saving ? `Checking…` : "Save"}
                </button>
                {key.set && (
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={r.saving}
                    onClick={() => save(key, "")}
                  >
                    Remove
                  </button>
                )}
              </form>
              {r.error && <div className="notice error">{r.error}</div>}
              {r.note && <div className="notice">{r.note}</div>}
            </section>
          );
        })}

        <p className="hint">
          Models and other options are in <code>.env.local</code> too (see <code>.env.example</code>). Restart the app
          after editing that file by hand.
        </p>
      </main>
    </div>
  );
}

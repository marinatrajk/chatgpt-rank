"use client";

import { Fragment, useState } from "react";
import type { CheckReport, CheckResult } from "@/lib/chatgpt-types";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The answer text with the brand's names marked. */
function Highlighted({ text, names }: { text: string; names: string[] }) {
  const terms = [...new Set(names.filter((n) => n.trim().length > 1))];
  if (terms.length === 0) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

export function YesNo({ result }: { result: CheckResult }) {
  if (result.status !== "ok") return <span className="yesno other">{result.status}</span>;
  if (result.mentioned) return <span className="yesno yes">YES</span>;
  return <span className="yesno no">{result.inAd ? "NO (ad only)" : "NO"}</span>;
}

// Citations are source names ("Allure +3") or shop links; links show as their site.
const sourceLabel = (c: string) => (/^https?:\/\//.test(c) && URL.canParse(c) ? new URL(c).hostname.replace(/^www\./, "") : c);

export function CheckReportView({ report }: { report: CheckReport }) {
  const [open, setOpen] = useState<number | null>(null);
  const [transcripts, setTranscripts] = useState<Record<number, string>>({});

  const brands = [...new Set(report.results.map((r) => r.brand))];
  const answered = report.results.filter((r) => r.status === "ok");
  const yes = answered.filter((r) => r.mentioned);

  const toggle = async (i: number, r: CheckResult) => {
    setOpen(open === i ? null : i);
    if (r.transcript && transcripts[i] === undefined) {
      const res = await fetch(`/api/chatgpt/transcript?file=${encodeURIComponent(r.transcript)}`);
      const text = res.ok ? await res.text() : "The saved answer couldn't be loaded.";
      setTranscripts((t) => ({ ...t, [i]: text }));
    }
  };

  return (
    <section>
      <div className="run-title">
        <h1>{brands.join(", ")} in ChatGPT</h1>
        <span className="meta">
          {new Date(report.startedAt).toLocaleString()} · {report.loggedIn ? "logged in" : "logged out"}
        </span>
      </div>

      <div className={`card verdict ${yes.length > 0 ? "yes" : "no"}`}>
        <p className="answer">
          <strong>{yes.length > 0 ? "Yes" : "No"}</strong> · {yes.length} of {answered.length} answers
        </p>
        {report.stoppedEarly && <p className="warn">Stopped early: {report.stoppedEarly}</p>}
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Query</th>
              <th>Mentioned</th>
              <th>Where</th>
              <th>Sentence</th>
            </tr>
          </thead>
          <tbody>
            {report.results.map((r, i) => (
              <Fragment key={i}>
                <tr className={r.transcript ? "clickable" : undefined} onClick={() => r.transcript && toggle(i, r)} aria-expanded={open === i}>
                  <td className="num">{i + 1}</td>
                  <td className="product-name">
                    {r.query}
                  </td>
                  <td>
                    <YesNo result={r} />
                  </td>
                  <td className="where">
                    {r.mentioned && r.line !== null ? `line ${r.line} of ${r.lines}` : ""}
                    {r.mentions > 1 && <div className="sub">{r.mentions}×</div>}
                  </td>
                  <td>
                    {r.sentence ? <span className="said">“{r.sentence}”</span> : r.error ? <span className="said error">{r.error}</span> : null}
                    {r.citations.length > 0 && (
                      <div className="sources">
                        {[...new Set(r.citations.map(sourceLabel))].slice(0, 6).map((label) => (
                          <span key={label} className="pill">
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
                {open === i && (
                  <tr>
                    <td />
                    <td colSpan={4}>
                      <div className="transcript">
                        {transcripts[i] === undefined ? (
                          "Loading…"
                        ) : (
                          <Highlighted text={transcripts[i]} names={[r.brand, r.variant ?? "", r.matchedText ?? ""]} />
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

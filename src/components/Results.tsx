"use client";

import { Fragment, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  brandReport,
  brandRows,
  domainRows,
  matchesBrand,
  productRows,
  type Cell,
  type ProductRow,
} from "@/lib/aggregate";
import { PROVIDER_LABELS, type Mention, type Product, type ProviderId, type Run } from "@/lib/types";

type Tab = "products" | "brands" | "sources" | "answers";

interface Props {
  run: Run;
  phase: "running" | "analyzing" | "done";
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const productLabel = (p: Product) => (p.name === p.brand ? p.brand : `${p.brand} ${p.name}`);

function HeatCell({ cell, provider }: { cell?: Cell; provider: ProviderId }) {
  if (!cell) return <span className="cell none">–</span>;
  if (cell.hits === 0) return <span className="cell none">0/{cell.total}</span>;
  const rate = cell.hits / cell.total;
  return (
    <span
      className="cell"
      style={{ background: `color-mix(in srgb, var(--${provider}) ${Math.round(12 + rate * 30)}%, transparent)` }}
    >
      <span className="hits">
        {cell.hits}/{cell.total}
      </span>
      {cell.avgPosition !== null && <span className="pos">avg #{cell.avgPosition.toFixed(1)}</span>}
    </span>
  );
}

function VisibilityBar({ value }: { value: number }) {
  return (
    <span className="bar">
      {pct(value)}
      <span className="track">
        <span className="fill" style={{ width: pct(value), display: "block" }} />
      </span>
    </span>
  );
}

function QuoteList({ mentions }: { mentions: (Mention & { provider: ProviderId; product?: Product })[] }) {
  return (
    <ul className="quotes">
      {mentions.map((m) => (
        <li key={`${m.answerId}-${m.productId}`}>
          <span className="who">
            <span className={`dot ${m.provider}`} /> {PROVIDER_LABELS[m.provider]} run {m.answerId.split("-")[1]} · #
            {m.position}
          </span>
          <span className={m.stance === "negative" ? "stance-negative" : undefined}>
            {m.product && m.product.name !== m.product.brand && <span className="product">{m.product.name}: </span>}
            “{m.quote}”{m.stance !== "recommended" && <span className="badge">{m.stance}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function answerLabel(run: Run, answerId: string): string {
  const a = run.answers.find((x) => x.id === answerId);
  return a ? `${PROVIDER_LABELS[a.provider]} run ${a.run}` : answerId;
}

/** The headline: is the user's brand in the answers, where, and in what words. */
function BrandVerdict({
  run,
  brand,
  onBrand,
  products,
}: {
  run: Run;
  brand: string;
  onBrand: (brand: string) => void;
  products: ProductRow[];
}) {
  const report = useMemo(() => brandReport(run, brand), [run, brand]);
  const name = brand.trim();
  const found = report !== null && report.answersWithMention > 0;
  const negative = report?.mentions.filter((m) => m.stance === "negative").length ?? 0;
  const citedIn = new Set(report?.citations.map((c) => c.answerId)).size;
  const citedDomains = [...new Set(report?.citations.map((c) => c.source.domain))];
  const instead = products.filter((r) => !matchesBrand(r.product.brand, name)).slice(0, 5);

  return (
    <div className={`card verdict${report ? (found ? " yes" : " no") : ""}`}>
      <div className="verdict-head">
        <input
          className="brand-input"
          value={brand}
          onChange={(e) => onBrand(e.target.value)}
          placeholder="Your brand, e.g. K18"
          aria-label="Your brand"
        />
        {report ? (
          <p className="answer">
            <strong>{found ? "Yes." : "No."}</strong>{" "}
            {found
              ? `${name} is named in ${report.answersWithMention} of ${report.okAnswers} answers${
                  report.avgPosition !== null ? `, at position #${report.avgPosition.toFixed(1)} on average` : ""
                }.`
              : `${name} isn't named in any of the ${report.okAnswers} answers.`}
          </p>
        ) : (
          <p className="answer muted">Type your brand to see whether the assistants mention it.</p>
        )}
      </div>

      {report && (
        <>
          <div className="verdict-cells">
            {run.settings.providers.map(
              (p) =>
                report.cells[p] && (
                  <span key={p}>
                    <span className={`dot ${p}`} /> {PROVIDER_LABELS[p]} <HeatCell cell={report.cells[p]} provider={p} />
                  </span>
                ),
            )}
          </div>
          {negative > 0 && (
            <p className="warn">
              Warned against in {negative} answer{negative === 1 ? "" : "s"}.
            </p>
          )}
          {report.mentions.length > 0 && <QuoteList mentions={report.mentions} />}
          {citedIn > 0 && (
            <p className="note">
              Your site was cited as a source in {citedIn} answer{citedIn === 1 ? "" : "s"}: {citedDomains.join(", ")}.
            </p>
          )}
          {report.textOnly.length > 0 && (
            <p className="note">
              The name also appears in {report.textOnly.map((id) => answerLabel(run, id)).join(", ")}, but not as a product
              the answer names. Check the wording under Answers.
            </p>
          )}
          {!found && instead.length > 0 && (
            <p className="note">
              Named instead: {instead.map((r) => productLabel(r.product)).join(", ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(run: Run, rows: ProductRow[]) {
  const providers = run.settings.providers;
  const header = [
    "rank",
    "brand",
    "product",
    "visibility",
    "avg_position",
    ...providers.flatMap((p) => [`${p}_mentions`, `${p}_answers`, `${p}_avg_position`]),
  ];
  const lines = rows.map((r, i) => [
    i + 1,
    r.product.brand,
    r.product.name,
    r.visibility.toFixed(3),
    r.avgPosition?.toFixed(2) ?? "",
    ...providers.flatMap((p) => {
      const c = r.cells[p];
      return [c?.hits ?? "", c?.total ?? "", c?.avgPosition?.toFixed(2) ?? ""];
    }),
  ]);
  const csv = [header, ...lines].map((l) => l.map(csvEscape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${run.settings.query.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${run.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Results({ run, phase }: Props) {
  const [tab, setTab] = useState<Tab>("products");
  const [brand, setBrand] = useState(run.settings.brand ?? "");
  const [expanded, setExpanded] = useState<string | null>(null);

  const providers = run.settings.providers;
  const products = useMemo(() => productRows(run), [run]);
  const brands = useMemo(() => brandRows(run), [run]);
  const domains = useMemo(() => domainRows(run), [run]);

  const okAnswers = run.answers.filter((a) => a.text);
  const failed = run.answers.filter((a) => a.error);
  const byAll = products.filter((r) => providers.every((p) => (r.cells[p]?.hits ?? 0) > 0)).length;
  const analysed = phase === "done" && !run.analysisError && okAnswers.length > 0;

  return (
    <section>
      <div className="run-title">
        <h1>“{run.settings.query}”</h1>
        <span className="meta">
          {new Date(run.createdAt).toLocaleString()} · {run.settings.runsPerProvider} run
          {run.settings.runsPerProvider > 1 ? "s" : ""} per assistant · web search{" "}
          {run.settings.webSearch ? `on${run.settings.country ? ` (${run.settings.country})` : ""}` : "off"}
        </span>
      </div>

      {phase === "done" && okAnswers.length === 0 && (
        <div className="notice error" style={{ marginBottom: 16 }}>
          Every request failed, so nothing was saved. The Answers tab shows each error.
        </div>
      )}

      {run.analysisError && (
        <div className="notice error" style={{ marginBottom: 16 }}>
          Product extraction failed: {run.analysisError}. The raw answers are still under Answers.
        </div>
      )}

      {analysed && <BrandVerdict run={run} brand={brand} onBrand={setBrand} products={products} />}

      {analysed && (
        <div className="stats">
          <div className="card stat">
            <div className="label">Answers analysed</div>
            <div className="value">{okAnswers.length}</div>
            <div className="sub">{failed.length > 0 ? `${failed.length} failed` : "none failed"}</div>
          </div>
          <div className="card stat">
            <div className="label">Products named</div>
            <div className="value">{products.length}</div>
            <div className="sub">from {brands.length} brands</div>
          </div>
          <div className="card stat">
            <div className="label">Most visible</div>
            <div className="value small">
              {products[0] ? productLabel(products[0].product) : "–"}
            </div>
            <div className="sub">{products[0] ? `${pct(products[0].visibility)} visibility` : ""}</div>
          </div>
          <div className="card stat">
            <div className="label">Named by every assistant</div>
            <div className="value">{providers.length > 1 ? byAll : "–"}</div>
            <div className="sub">{providers.length > 1 ? "products" : "needs 2+ assistants"}</div>
          </div>
        </div>
      )}

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {(
            [
              ["products", `Products${analysed ? ` (${products.length})` : ""}`],
              ["brands", `Brands${analysed ? ` (${brands.length})` : ""}`],
              ["sources", `Sources (${domains.length})`],
              ["answers", `Answers (${run.answers.length})`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {tab === "products" && analysed && products.length > 0 && (
          <button className="btn secondary" onClick={() => downloadCsv(run, products)}>
            Export CSV
          </button>
        )}
      </div>

      {(tab === "products" || tab === "brands") && !analysed && (
        <div className="card placeholder">
          {phase === "running"
            ? "Waiting for the assistants to answer… you can read answers as they arrive in the Answers tab."
            : phase === "analyzing"
              ? "Claude is reading the answers and pulling out the products…"
              : "No product data for this run."}
        </div>
      )}

      {tab === "products" && analysed && (
        <div className="card table-wrap">
          {products.length === 0 ? (
            <div className="placeholder">No specific products were named in these answers.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Product</th>
                  {providers.map((p) => (
                    <th key={p}>
                      <span className={`dot ${p}`} /> {PROVIDER_LABELS[p]}
                    </th>
                  ))}
                  <th className="num" title="Average share of answers that mention it, across assistants">
                    Visibility
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((r, i) => {
                  const open = expanded === r.product.id;
                  const hl = matchesBrand(r.product.brand, brand);
                  return (
                    <Fragment key={r.product.id}>
                      <tr
                        className={`clickable${hl ? " highlight" : ""}`}
                        onClick={() => setExpanded(open ? null : r.product.id)}
                        aria-expanded={open}
                      >
                        <td className="num">{i + 1}</td>
                        <td className="product-name">
                          <span className="brand">{r.product.brand}</span>{" "}
                          {r.product.name !== r.product.brand && r.product.name}
                          {r.stances.negative > 0 && (
                            <span className="badge negative">warned against ×{r.stances.negative}</span>
                          )}
                          <div className="sub">{open ? "Hide quotes" : `${r.mentions.length} mention${r.mentions.length === 1 ? "" : "s"} · show quotes`}</div>
                        </td>
                        {providers.map((p) => (
                          <td key={p}>
                            <HeatCell cell={r.cells[p]} provider={p} />
                          </td>
                        ))}
                        <td className="num">
                          <VisibilityBar value={r.visibility} />
                        </td>
                      </tr>
                      {open && (
                        <tr className={hl ? "highlight" : undefined}>
                          <td />
                          <td colSpan={providers.length + 2}>
                            <QuoteList mentions={r.mentions} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "brands" && analysed && (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Brand</th>
                {providers.map((p) => (
                  <th key={p}>
                    <span className={`dot ${p}`} /> {PROVIDER_LABELS[p]}
                  </th>
                ))}
                <th className="num">Visibility</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b, i) => (
                <tr key={b.brand} className={matchesBrand(b.brand, brand) ? "highlight" : undefined}>
                  <td className="num">{i + 1}</td>
                  <td className="product-name">
                    <span className="brand">{b.brand}</span>
                    <div className="sub">
                      {b.products.map((p) => (p.name === b.brand ? "(brand only)" : p.name)).join(" · ")}
                    </div>
                  </td>
                  {providers.map((p) => (
                    <td key={p}>
                      <HeatCell cell={b.cells[p]} provider={p} />
                    </td>
                  ))}
                  <td className="num">
                    <VisibilityBar value={b.visibility} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "sources" && (
        <div className="card table-wrap">
          {domains.length === 0 ? (
            <div className="placeholder">
              {run.settings.webSearch ? "No cited sources yet." : "Web search was off for this run, so nothing was cited."}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Site the assistants cited</th>
                  {providers.map((p) => (
                    <th key={p}>
                      <span className={`dot ${p}`} /> {PROVIDER_LABELS[p]}
                    </th>
                  ))}
                  <th className="num">Answers citing it</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.domain}>
                    <td>{d.domain}</td>
                    {providers.map((p) => (
                      <td key={p}>
                        <HeatCell cell={d.cells[p]} provider={p} />
                      </td>
                    ))}
                    <td className="num">{d.totalAnswers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "answers" && <Answers run={run} />}
    </section>
  );
}

function Answers({ run }: { run: Run }) {
  const [filter, setFilter] = useState<ProviderId | "all">("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const productById = new Map(run.products.map((p) => [p.id, p]));
  const answers = run.answers
    .filter((a) => filter === "all" || a.provider === filter)
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.run - b.run);

  return (
    <>
      <div className="answer-filters" style={{ marginBottom: 10 }}>
        {(["all", ...run.settings.providers] as const).map((p) => (
          <button key={p} className={filter === p ? "active" : ""} onClick={() => setFilter(p)}>
            {p !== "all" && <span className={`dot ${p}`} />}
            {p === "all" ? "All" : PROVIDER_LABELS[p]}
          </button>
        ))}
      </div>
      {answers.length === 0 && <div className="card placeholder">Answers will show up here as they arrive.</div>}
      <div className="answers">
        {answers.map((a) => {
          const mentions = run.mentions.filter((m) => m.answerId === a.id).sort((x, y) => x.position - y.position);
          const expanded = open.has(a.id);
          return (
            <article key={a.id} className="card answer">
              <header>
                <span className={`dot ${a.provider}`} />
                <strong>
                  {PROVIDER_LABELS[a.provider]} · run {a.run}
                </strong>
                <span className="meta">
                  {a.model} · {(a.durationMs / 1000).toFixed(1)}s
                </span>
              </header>
              {a.error ? (
                <div className="error-body">Failed: {a.error}</div>
              ) : (
                <>
                  <div className={`body${expanded ? " expanded" : ""}`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.text ?? ""}</ReactMarkdown>
                  </div>
                  <footer>
                    <div>
                      <button
                        className="linklike"
                        onClick={() =>
                          setOpen((prev) => {
                            const next = new Set(prev);
                            if (next.has(a.id)) next.delete(a.id);
                            else next.add(a.id);
                            return next;
                          })
                        }
                      >
                        {expanded ? "Collapse answer" : "Show full answer"}
                      </button>
                    </div>
                    {mentions.length > 0 && (
                      <div>
                        <span className="label">Products in order:</span>
                        {mentions.map((m) => {
                          const p = productById.get(m.productId);
                          return (
                            <span key={m.productId} className="pill">
                              #{m.position} {p?.brand} {p && p.name !== p.brand ? p.name : ""}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {a.sources.length > 0 && (
                      <div>
                        <span className="label">Sources:</span>
                        {a.sources.map((s) => (
                          <a key={s.url} className="pill" href={s.url} target="_blank" rel="noreferrer" title={s.title}>
                            {s.domain}
                          </a>
                        ))}
                      </div>
                    )}
                    {run.settings.webSearch && a.searchQueries.length === 0 && a.sources.length === 0 && (
                      <div className="label">Answered from memory, without searching the web.</div>
                    )}
                    {a.searchQueries.length > 0 && (
                      <div>
                        <span className="label" title="The assistant wrote these web searches itself. Your prompt was sent to it unchanged.">
                          Web searches it ran on its own:
                        </span>
                        {a.searchQueries.map((q, i) => (
                          <span key={i} className="pill">
                            {q}
                          </span>
                        ))}
                      </div>
                    )}
                  </footer>
                </>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

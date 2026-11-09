// Turns a run's raw mentions into the tables shown in the UI. Pure functions, used client-side.

import type { Mention, Product, ProviderId, Run, Source, Stance } from "./types";

export interface Cell {
  hits: number; // answers that mention it
  total: number; // successful answers from this provider
  avgPosition: number | null;
}

export interface ProductRow {
  product: Product;
  cells: Partial<Record<ProviderId, Cell>>;
  visibility: number; // mean mention rate across providers, 0..1
  avgPosition: number | null;
  mentions: (Mention & { provider: ProviderId })[];
  stances: Record<Stance, number>;
}

export interface BrandRow {
  brand: string;
  products: Product[];
  cells: Partial<Record<ProviderId, Cell>>;
  visibility: number;
  avgPosition: number | null;
}

export interface DomainRow {
  domain: string;
  cells: Partial<Record<ProviderId, Cell>>;
  totalAnswers: number;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function answerTotals(run: Run): Map<ProviderId, number> {
  const totals = new Map<ProviderId, number>();
  for (const a of run.answers) {
    if (a.text) totals.set(a.provider, (totals.get(a.provider) ?? 0) + 1);
  }
  return totals;
}

/** Builds per-provider cells from a list of (answerId, position) hits; one hit per answer. */
function buildCells(
  run: Run,
  hits: { answerId: string; position: number | null }[],
): { cells: Partial<Record<ProviderId, Cell>>; visibility: number; avgPosition: number | null } {
  const totals = answerTotals(run);
  const providerOf = new Map(run.answers.map((a) => [a.id, a.provider]));
  const byAnswer = new Map<string, number | null>();
  for (const h of hits) {
    const prev = byAnswer.get(h.answerId);
    if (prev === undefined || (h.position !== null && (prev === null || h.position < prev))) {
      byAnswer.set(h.answerId, h.position);
    }
  }

  const cells: Partial<Record<ProviderId, Cell>> = {};
  const rates: number[] = [];
  for (const provider of run.settings.providers) {
    const total = totals.get(provider) ?? 0;
    if (total === 0) continue;
    const positions: number[] = [];
    let count = 0;
    for (const [answerId, pos] of byAnswer) {
      if (providerOf.get(answerId) !== provider) continue;
      count++;
      if (pos !== null) positions.push(pos);
    }
    cells[provider] = { hits: count, total, avgPosition: mean(positions) };
    rates.push(count / total);
  }
  const allPositions = [...byAnswer.values()].filter((p): p is number => p !== null);
  return { cells, visibility: mean(rates) ?? 0, avgPosition: mean(allPositions) };
}

function byVisibility<T extends { visibility: number; avgPosition: number | null }>(a: T, b: T): number {
  return b.visibility - a.visibility || (a.avgPosition ?? 99) - (b.avgPosition ?? 99);
}

export function productRows(run: Run): ProductRow[] {
  const providerOf = new Map(run.answers.map((a) => [a.id, a.provider]));
  return run.products
    .map((product) => {
      const mentions = run.mentions
        .filter((m) => m.productId === product.id)
        .map((m) => ({ ...m, provider: providerOf.get(m.answerId)! }));
      const stances: Record<Stance, number> = { recommended: 0, mentioned: 0, negative: 0 };
      for (const m of mentions) stances[m.stance]++;
      return { product, mentions, stances, ...buildCells(run, mentions) };
    })
    .sort(byVisibility);
}

export function brandRows(run: Run): BrandRow[] {
  const groups = new Map<string, { brand: string; products: Product[] }>();
  for (const p of run.products) {
    const key = p.brand.toLowerCase();
    const g = groups.get(key) ?? { brand: p.brand, products: [] };
    g.products.push(p);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ brand, products }) => {
      const ids = new Set(products.map((p) => p.id));
      const hits = run.mentions.filter((m) => ids.has(m.productId));
      return { brand, products, ...buildCells(run, hits) };
    })
    .sort(byVisibility);
}

export function domainRows(run: Run): DomainRow[] {
  const hitsByDomain = new Map<string, { answerId: string; position: null }[]>();
  for (const a of run.answers) {
    if (!a.text) continue;
    for (const domain of new Set(a.sources.map((s) => s.domain))) {
      const list = hitsByDomain.get(domain) ?? [];
      list.push({ answerId: a.id, position: null });
      hitsByDomain.set(domain, list);
    }
  }
  return [...hitsByDomain.entries()]
    .map(([domain, hits]) => ({ domain, cells: buildCells(run, hits).cells, totalAnswers: hits.length }))
    .sort((a, b) => b.totalAnswers - a.totalAnswers || a.domain.localeCompare(b.domain));
}

export function matchesBrand(brand: string, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  return n.length > 0 && brand.toLowerCase().includes(n);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface BrandReport {
  brands: string[]; // the matching brands, spelled as the extractor wrote them
  cells: Partial<Record<ProviderId, Cell>>;
  visibility: number;
  avgPosition: number | null;
  answersWithMention: number;
  okAnswers: number;
  mentions: (Mention & { provider: ProviderId; product: Product })[];
  // Answers whose text contains the name although no product of the brand was extracted from them.
  textOnly: string[];
  // Cited pages whose domain contains the brand name, e.g. k18hair.com for "K18".
  citations: { answerId: string; provider: ProviderId; source: Source }[];
}

export function brandReport(run: Run, needle: string): BrandReport | null {
  const n = needle.trim();
  if (!n) return null;
  const products = run.products.filter((p) => matchesBrand(p.brand, n));
  const ids = new Set(products.map((p) => p.id));
  const productById = new Map(products.map((p) => [p.id, p]));
  const providerOf = new Map(run.answers.map((a) => [a.id, a.provider]));
  const mentions = run.mentions
    .filter((m) => ids.has(m.productId))
    .map((m) => ({ ...m, provider: providerOf.get(m.answerId)!, product: productById.get(m.productId)! }));
  const mentioned = new Set(mentions.map((m) => m.answerId));

  const okAnswers = run.answers.filter((a) => a.text);
  // Whole-word match, so "K18" doesn't match "K180".
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(n)}($|[^\\p{L}\\p{N}])`, "iu");
  const textOnly = okAnswers.filter((a) => !mentioned.has(a.id) && word.test(a.text!)).map((a) => a.id);

  const compact = n.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const citations = compact
    ? okAnswers.flatMap((a) =>
        a.sources.filter((s) => s.domain.toLowerCase().includes(compact)).map((source) => ({ answerId: a.id, provider: a.provider, source })),
      )
    : [];

  return {
    brands: [...new Set(products.map((p) => p.brand))],
    ...buildCells(run, mentions),
    answersWithMention: mentioned.size,
    okAnswers: okAnswers.length,
    mentions,
    textOnly,
    citations,
  };
}

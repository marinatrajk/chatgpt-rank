// Finds a brand's names in an answer. Pure functions: no browser needed, covered by match.test.ts.
//
// Every name (the brand and its variants) is matched case-insensitively as a whole word, so "k18"
// doesn't match inside "k180" or "k18hair". Spacing and dashes between letters and digits are optional.
//
//   exact     as written in pairs.json ("K18")
//   spelling  same name, other case or separators ("k18", "K-18", "K 18")
//   fuzzy     one typo away, only for names of 5+ characters ("Olaplx" for "Olaplex");
//             shorter names would match too much ("K19" for "K18")

export type MatchKind = "exact" | "spelling" | "fuzzy";

export interface BrandMatch {
  kind: MatchKind;
  variant: string; // the name from pairs.json that matched
  text: string; // as written in the answer
  offset: number; // character position in the answer
  line: number; // 1-based line of the answer: a paragraph, list item or table row
  lines: number; // total non-empty lines in the answer
  sentence: string; // the sentence around the match
}

const RANK: Record<MatchKind, number> = { exact: 0, spelling: 1, fuzzy: 2 };
const FUZZY_MIN_LENGTH = 5;
const SENTENCE_MAX = 300;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** "K18" -> /K[\s\-_.]?18/ with word edges: letters and digits split, separators optional. */
function spellingPattern(name: string): RegExp | null {
  const parts = name.match(/\p{L}+|\p{N}+/gu);
  if (!parts) return null;
  const body = parts.map(escapeRegExp).join("[\\s\\-_.·]?");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

interface Line {
  start: number;
  end: number;
}

function splitLines(text: string): Line[] {
  const out: Line[] = [];
  const re = /[^\n]+/g;
  for (let m; (m = re.exec(text)); ) {
    if (m[0].trim()) out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The sentence containing [from, to), cut at . ! ? or the line's edges. */
function sentenceAround(text: string, line: Line, from: number, to: number): string {
  const before = text.slice(line.start, from);
  const boundary = Math.max(...[...before.matchAll(/[.!?](?=\s)/g)].map((m) => m.index! + 1), 0);
  const start = line.start + boundary;
  const after = text.slice(to, line.end);
  const stop = after.search(/[.!?](\s|$)/);
  const end = stop === -1 ? line.end : to + stop + 1;
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (s.length > SENTENCE_MAX) {
    const at = Math.max(0, from - start - SENTENCE_MAX / 2);
    s = `…${s.slice(at, at + SENTENCE_MAX).trim()}…`;
  }
  return s;
}

/** The brand's names with duplicates (ignoring case) removed, brand first. */
export function names(brand: string, variants: string[] = []): string[] {
  const seen = new Set<string>();
  return [brand, ...variants]
    .map((n) => n.trim())
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

export function findBrand(text: string, brand: string, variants: string[] = []): BrandMatch[] {
  const found: Omit<BrandMatch, "line" | "lines" | "sentence">[] = [];
  const all = names(brand, variants);

  for (const name of all) {
    const re = spellingPattern(name);
    if (!re) continue;
    for (const m of text.matchAll(re)) {
      found.push({ kind: m[0] === name ? "exact" : "spelling", variant: name, text: m[0], offset: m.index! });
    }
  }

  for (const name of all) {
    const key = compact(name);
    if (key.length < FUZZY_MIN_LENGTH) continue;
    for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
      const word = m[0].toLowerCase();
      if (Math.abs(word.length - key.length) <= 1 && word !== key && levenshtein(word, key) === 1) {
        found.push({ kind: "fuzzy", variant: name, text: m[0], offset: m.index! });
      }
    }
  }

  // Keep one match per stretch of text: the strongest kind wins where matches overlap.
  found.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.offset - b.offset);
  const kept: typeof found = [];
  for (const f of found) {
    const end = f.offset + f.text.length;
    if (!kept.some((k) => f.offset < k.offset + k.text.length && k.offset < end)) kept.push(f);
  }
  kept.sort((a, b) => a.offset - b.offset);

  const lines = splitLines(text);
  return kept.map((f) => {
    const index = lines.findIndex((l) => f.offset >= l.start && f.offset < l.end);
    const line = lines[index] ?? { start: 0, end: text.length };
    return {
      ...f,
      line: index + 1,
      lines: lines.length,
      sentence: sentenceAround(text, line, f.offset, f.offset + f.text.length),
    };
  });
}

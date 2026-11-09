import type { Source } from "../types";

const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const p of TRACKING_PARAMS) url.searchParams.delete(p);
    return url.toString();
  } catch {
    return raw;
  }
}

function hostname(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * Normalises and de-duplicates sources. `domainHint` is used when the URL is a
 * redirect (Gemini returns Google redirect URLs and puts the real domain in the title).
 */
export function collectSources(
  raw: { url?: string | null; title?: string | null; domainHint?: string | null }[],
): Source[] {
  const seen = new Map<string, Source>();
  for (const r of raw) {
    if (!r.url) continue;
    const url = cleanUrl(r.url);
    if (seen.has(url)) continue;
    const hint = r.domainHint?.trim().replace(/^www\./, "");
    const domain = hint && DOMAIN_LIKE.test(hint) ? hint.toLowerCase() : hostname(url);
    seen.set(url, { url, title: r.title?.trim() || domain, domain });
  }
  return [...seen.values()];
}

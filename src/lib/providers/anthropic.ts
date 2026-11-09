import Anthropic from "@anthropic-ai/sdk";
import { collectSources } from "./sources";
import type { AskOptions, ProviderAnswer } from "./index";

let client: Anthropic | undefined;
let clientKey: string | undefined;

export function anthropicClient(): Anthropic {
  // A new client when the key changes on the Settings page.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!client || clientKey !== key) [client, clientKey] = [new Anthropic({ apiKey: key }), key];
  return client;
}

// A server-side web search turn can pause; we resume it a few times at most.
const MAX_CONTINUATIONS = 4;

export async function askClaude(query: string, opts: AskOptions): Promise<ProviderAnswer> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: query }];
  const tools: Anthropic.Beta.BetaToolUnion[] = opts.webSearch
    ? [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: 5,
          ...(opts.country && { user_location: { type: "approximate" as const, country: opts.country } }),
        },
      ]
    : [];

  let text = "";
  let model = opts.model;
  const cited: { url: string; title: string | null }[] = [];
  // With dynamic filtering Claude searches from inside a code sandbox and its text usually carries no
  // citations, so the pages its searches returned are the next best record of what it read.
  const retrieved: { url: string; title: string | null }[] = [];
  const searchQueries: string[] = [];

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const response = await anthropicClient().beta.messages.create({
      model: opts.model,
      max_tokens: 16000,
      // If a safety classifier declines, retry on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...(tools.length > 0 && { tools }),
      messages,
    });
    model = response.model;

    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category;
      throw new Error(`Claude declined to answer${category ? ` (${category})` : ""}`);
    }

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location") cited.push({ url: c.url, title: c.title });
        }
      } else if (block.type === "server_tool_use" && block.name === "web_search") {
        const q = (block.input as { query?: unknown }).query;
        if (typeof q === "string") searchQueries.push(q);
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) retrieved.push({ url: r.url, title: r.title });
      }
    }

    if (response.stop_reason !== "pause_turn") break;
    // Resume the paused turn: send the partial assistant content back unchanged.
    messages.push({ role: "assistant", content: response.content });
  }

  return {
    text,
    model,
    sources: collectSources(cited.length > 0 ? cited : retrieved),
    searchQueries: [...new Set(searchQueries)],
  };
}

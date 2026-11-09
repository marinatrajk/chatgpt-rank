import OpenAI from "openai";
import { collectSources } from "./sources";
import type { AskOptions, ProviderAnswer } from "./index";

let client: OpenAI | undefined;
let clientKey: string | undefined;

export async function askChatGPT(query: string, opts: AskOptions): Promise<ProviderAnswer> {
  // A new client when the key changes on the Settings page.
  const key = process.env.OPENAI_API_KEY;
  if (!client || clientKey !== key) [client, clientKey] = [new OpenAI({ apiKey: key }), key];

  const response = await client.responses.create({
    model: opts.model,
    input: query,
    ...(opts.webSearch && {
      tools: [
        {
          type: "web_search",
          ...(opts.country && { user_location: { type: "approximate", country: opts.country } }),
        },
      ],
    }),
  });

  const cited: { url: string; title: string }[] = [];
  const searchQueries: string[] = [];
  for (const item of response.output) {
    if (item.type === "message") {
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const a of part.annotations) {
          if (a.type === "url_citation") cited.push({ url: a.url, title: a.title });
        }
      }
    } else if (item.type === "web_search_call" && item.action?.type === "search") {
      const qs = item.action.queries ?? (item.action.query ? [item.action.query] : []);
      searchQueries.push(...qs);
    }
  }

  return {
    text: response.output_text,
    model: response.model,
    sources: collectSources(cited),
    searchQueries,
  };
}

import { GoogleGenAI } from "@google/genai";
import { collectSources } from "./sources";
import type { AskOptions, ProviderAnswer } from "./index";

let client: GoogleGenAI | undefined;
let clientKey: string | undefined;

export async function askGemini(query: string, opts: AskOptions): Promise<ProviderAnswer> {
  // A new client when the key changes on the Settings page.
  const key = process.env.GEMINI_API_KEY;
  if (!client || clientKey !== key) [client, clientKey] = [new GoogleGenAI({ apiKey: key }), key];

  // Google Search grounding has no location parameter, so `country` is not applied here.
  const response = await client.models.generateContent({
    model: opts.model,
    contents: query,
    ...(opts.webSearch && { config: { tools: [{ googleSearch: {} }] } }),
  });

  const grounding = response.candidates?.[0]?.groundingMetadata;
  const chunks = (grounding?.groundingChunks ?? []).flatMap((c) => (c.web ? [c.web] : []));

  return {
    text: response.text ?? "",
    model: response.modelVersion ?? opts.model,
    // Gemini returns Google redirect URLs; the real site is in `domain` or `title`.
    sources: collectSources(
      chunks.map((w) => ({ url: w.uri, title: w.title, domainHint: w.domain ?? w.title })),
    ),
    searchQueries: grounding?.webSearchQueries ?? [],
  };
}

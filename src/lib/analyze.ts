import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { anthropicClient } from "./providers/anthropic";
import { PROVIDER_LABELS, type Answer, type Mention, type Product } from "./types";

export function analyzerModel(): string {
  return process.env.ANALYZER_MODEL || "claude-opus-5-5";
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

function analyzerEffort(): Effort {
  const e = process.env.ANALYZER_EFFORT as Effort | undefined;
  return e && EFFORTS.includes(e) ? e : "medium";
}

const AnalysisSchema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      brand: z.string(),
      name: z.string(),
    }),
  ),
  answers: z.array(
    z.object({
      answer_id: z.string(),
      mentions: z.array(
        z.object({
          product_id: z.string(),
          stance: z.enum(["recommended", "mentioned", "negative"]),
          quote: z.string(),
        }),
      ),
    }),
  ),
});

const INSTRUCTIONS = `You are building a product-visibility report: which products AI assistants recommend for a shopper's query. Below are several assistants' answers to the same query.

Extract every specific commercial product or product line named in the answers.
- A product has a brand and a product name, e.g. brand "Nioxin", name "System 2 Cleanser Shampoo".
- If an answer names only a brand (e.g. "anything from Pura D'or"), record it with the brand's name as the product name.
- Skip generic ingredients, drug names and categories ("biotin", "a ketoconazole shampoo", "minoxidil") unless tied to a brand ("Rogaine Foam" counts; "minoxidil 5%" does not). Skip retailers and websites.

Merge the same product across answers into one entry, even when it is worded differently ("Nioxin System 2" and "Nioxin System 2 Cleanser Shampoo" are one product). Keep genuinely different products separate ("System 1" vs "System 2"). Spell each brand identically everywhere. Give products ids p1, p2, p3...

For every answer id you were given, list its mentions in the order the products first appear in that answer, each product at most once per answer. Return an empty list for an answer that names no products.
- stance: "recommended" when presented as a pick or good option, "mentioned" when named neutrally or in passing, "negative" when the answer warns against it.
- quote: a short verbatim phrase (at most 15 words) from that answer showing how it describes the product.`;

export interface Analysis {
  products: Product[];
  mentions: Mention[];
}

export async function analyzeAnswers(query: string, answers: Answer[]): Promise<Analysis> {
  const ok = answers.filter((a) => a.text);
  if (ok.length === 0) return { products: [], mentions: [] };

  const transcript = ok
    .map(
      (a) =>
        `<answer id="${a.id}" assistant="${PROVIDER_LABELS[a.provider]}">\n${a.text}\n</answer>`,
    )
    .join("\n\n");

  const response = await anthropicClient().beta.messages.parse({
    model: analyzerModel(),
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: analyzerEffort(), format: betaZodOutputFormat(AnalysisSchema) },
    messages: [
      {
        role: "user",
        content: `${INSTRUCTIONS}\n\n<query>${query}</query>\n\n${transcript}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("The analyzer declined this request");
  if (response.stop_reason === "max_tokens") throw new Error("The analysis was too long and got cut off");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("The analyzer returned output that didn't match the schema");

  const products: Product[] = parsed.products.map((p) => ({
    id: p.id,
    brand: p.brand.trim(),
    name: p.name.trim(),
  }));
  const productIds = new Set(products.map((p) => p.id));
  const answerIds = new Set(ok.map((a) => a.id));

  const mentions: Mention[] = [];
  for (const entry of parsed.answers) {
    if (!answerIds.has(entry.answer_id)) continue;
    const seen = new Set<string>();
    for (const m of entry.mentions) {
      if (!productIds.has(m.product_id) || seen.has(m.product_id)) continue;
      seen.add(m.product_id);
      mentions.push({
        answerId: entry.answer_id,
        productId: m.product_id,
        position: seen.size,
        stance: m.stance,
        quote: m.quote,
      });
    }
  }

  // Drop products the analyzer listed but never attributed to an answer.
  const used = new Set(mentions.map((m) => m.productId));
  return { products: products.filter((p) => used.has(p.id)), mentions };
}

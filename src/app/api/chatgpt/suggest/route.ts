import * as z from "zod/v4";
import { errorMessage } from "@/lib/errors";
import { suggestModel, suggestQueries } from "@/lib/suggest-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SuggestRequest = z.object({ input: z.string().trim().min(1).max(200) });

export async function POST(request: Request) {
  const parsed = SuggestRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Type a brand name or website." }, { status: 400 });
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "Suggesting queries needs an OpenAI key (add it in Settings), or click Write my own." },
      { status: 400 },
    );
  }
  try {
    return Response.json({ ...(await suggestQueries(parsed.data.input)), model: suggestModel() });
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 502 });
  }
}

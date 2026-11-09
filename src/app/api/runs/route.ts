import * as z from "zod/v4";
import { providerStatus } from "@/lib/providers";
import { executeRun } from "@/lib/run";
import { listRuns } from "@/lib/storage";
import { PROVIDER_IDS, PROVIDER_LABELS, type RunEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const RunRequest = z.object({
  query: z.string().trim().min(3).max(500),
  providers: z.array(z.enum(PROVIDER_IDS)).min(1),
  runsPerProvider: z.number().int().min(1).max(5),
  webSearch: z.boolean(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  brand: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((b) => b || undefined),
});

export async function GET() {
  return Response.json(await listRuns());
}

export async function POST(request: Request) {
  const parsed = RunRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  const settings = { ...parsed.data, providers: [...new Set(parsed.data.providers)] };

  const missing = settings.providers.filter((p) => !providerStatus(p).configured);
  if (missing.length > 0) {
    const names = missing.map((p) => `${PROVIDER_LABELS[p]} (${providerStatus(p).envKey})`).join(", ");
    return Response.json({ error: `Missing API keys for: ${names}` }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: RunEvent) => {
        if (!open) return; // the browser went away; the run still finishes and is saved
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        await executeRun(settings, emit);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
      if (open) controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}

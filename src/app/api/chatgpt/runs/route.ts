import * as z from "zod/v4";
import { isCheckRunning, listReports, runCheck } from "@/lib/chatgpt-check";
import { MAX_CHECK_QUERIES, type CheckEvent } from "@/lib/chatgpt-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const CheckRequest = z.object({
  brand: z.string().trim().min(1).max(80),
  variants: z.array(z.string().trim().min(1).max(80)).max(10),
  queries: z.array(z.string().trim().min(3).max(500)).min(1).max(MAX_CHECK_QUERIES),
});

export async function GET() {
  return Response.json(await listReports());
}

export async function POST(request: Request) {
  const parsed = CheckRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  if (isCheckRunning()) {
    return Response.json({ error: "A ChatGPT check is already running. Wait for it to finish." }, { status: 409 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: CheckEvent) => {
        if (!open) return; // the browser went away; the check still finishes and is saved
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        await runCheck(parsed.data, emit);
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

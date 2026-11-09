import { getTranscript } from "@/lib/chatgpt-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const file = new URL(request.url).searchParams.get("file") ?? "";
  const text = await getTranscript(file);
  return text === null
    ? Response.json({ error: "Not found" }, { status: 404 })
    : new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}

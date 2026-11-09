import { getReport } from "@/lib/chatgpt-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const report = await getReport((await params).id);
  return report ? Response.json(report) : Response.json({ error: "Not found" }, { status: 404 });
}

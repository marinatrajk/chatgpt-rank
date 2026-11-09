import { deleteRun, getRun } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const run = await getRun(id).catch(() => null);
  return run ? Response.json(run) : Response.json({ error: "Run not found" }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    await deleteRun(id);
  } catch {
    return Response.json({ error: "Invalid run id" }, { status: 400 });
  }
  return new Response(null, { status: 204 });
}

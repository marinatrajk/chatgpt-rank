import { API_KEYS, checkKey, cleanKey, keyFormatProblem, saveEnvValues } from "@/lib/api-keys.mjs";
import type { KeyStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function keyStatus(): KeyStatus[] {
  return API_KEYS.map((k) => {
    const value = process.env[k.env] ?? "";
    return { ...k, set: Boolean(value), hint: value ? `…${value.slice(-4)}` : null };
  });
}

/**
 * Only this app's own pages may change keys: the request must be JSON from the same origin, so another
 * website open in your browser can't post to it.
 */
function fromThisApp(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || !request.headers.get("content-type")?.startsWith("application/json")) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function GET() {
  return Response.json(keyStatus());
}

/** { env, value }: checks the key with its vendor and saves it to .env.local. An empty value removes it. */
export async function POST(request: Request) {
  if (!fromThisApp(request)) return Response.json({ error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { env?: unknown; value?: unknown } | null;
  const info = API_KEYS.find((k) => k.env === body?.env);
  if (!info || typeof body?.value !== "string") return Response.json({ error: "Bad request." }, { status: 400 });

  const value = cleanKey(body.value);
  let warning: string | undefined;
  if (value) {
    const problem = keyFormatProblem(value);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    const check = await checkKey(info.env, value);
    if (check.status === "invalid") return Response.json({ error: check.message }, { status: 400 });
    if (check.status === "unknown") warning = `${check.message} Saved it anyway.`;
  }

  await saveEnvValues(process.cwd(), { [info.env]: value });
  process.env[info.env] = value; // takes effect now, no restart needed
  return Response.json({ keys: keyStatus(), warning });
}

/** SDK errors often carry the vendor's JSON body in the message; pull out the readable part. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const brace = msg.indexOf("{");
  if (brace === -1) return msg;
  try {
    const body = JSON.parse(msg.slice(brace));
    const inner = body?.error?.message ?? body?.message;
    if (typeof inner === "string") {
      const status = msg.match(/^\d{3}\b/)?.[0];
      return status ? `${status} ${inner}` : inner;
    }
  } catch {
    // not JSON after all
  }
  return msg;
}

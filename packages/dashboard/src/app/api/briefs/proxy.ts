const BACKEND_PORT = process.env.CLAUDE_AGENT_PORT ?? "8787";
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;

// Brief generation can legitimately take longer than the dashboard rewrite
// proxy waits. Keep these long-running POSTs behind explicit route handlers so
// the backend can finish and return any queued approvals instead of the browser
// seeing a 500 after the approval was already created.
const BRIEF_PROXY_TIMEOUT_MS = Number(
  process.env.CLAUDE_AGENT_BRIEF_PROXY_TIMEOUT_MS ?? 120_000,
);

export type BriefProxyType = "daily" | "evening";

export async function proxyBriefRequest(type: BriefProxyType): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_ORIGIN}/api/briefs/${type}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(BRIEF_PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut =
      err instanceof DOMException && err.name === "TimeoutError";
    return Response.json(
      {
        kind: "error",
        error: timedOut
          ? "Brief request timed out before the backend finished."
          : "Cannot reach the backend for brief generation.",
      },
      { status: timedOut ? 504 : 502 },
    );
  }

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

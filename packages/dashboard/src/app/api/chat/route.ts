import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_PORT = process.env.CLAUDE_AGENT_PORT ?? "8787";
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;

// Chat turns invoke Claude and can take up to CLAUDE_BRIEF_TIMEOUT_MS (90s).
// The Next.js rewrite proxy times out before that, causing a 500 to the
// browser while Fastify still completes and saves the data. This explicit
// route handler bypasses the rewrite and applies its own generous timeout.
const CHAT_PROXY_TIMEOUT_MS = Number(
  process.env.CLAUDE_AGENT_CHAT_PROXY_TIMEOUT_MS ?? 95_000,
);

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();
  let res: Response;
  try {
    res = await fetch(`${BACKEND_ORIGIN}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(CHAT_PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return NextResponse.json(
      {
        kind: "error",
        error: timedOut
          ? "Chat request timed out — the agent may still be processing. Refresh to see if a response was saved."
          : "Cannot reach the backend.",
      },
      { status: timedOut ? 504 : 502 },
    );
  }

  const responseBody = await res.text();
  return new Response(responseBody, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

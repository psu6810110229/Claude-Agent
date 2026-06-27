import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_PORT = process.env.CLAUDE_AGENT_PORT ?? "8787";
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;

// Streaming chat: forward the backend SSE body straight through WITHOUT buffering
// so live `thinking` events reach the browser as they arrive. A generous timeout
// covers slow reasoning models (qwen/glm can take 25–45s) plus the answer parse.
const CHAT_STREAM_TIMEOUT_MS = Number(
  process.env.CLAUDE_AGENT_CHAT_PROXY_TIMEOUT_MS ?? 120_000,
);

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();
  let res: Response;
  try {
    res = await fetch(`${BACKEND_ORIGIN}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(CHAT_STREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return NextResponse.json(
      {
        kind: "error",
        error: timedOut
          ? "Chat request timed out — the agent may still be processing."
          : "Cannot reach the backend.",
      },
      { status: timedOut ? 504 : 502 },
    );
  }

  // Non-SSE (e.g. a 400/503 prep error returned as JSON) → pass through as-is.
  const contentType = res.headers.get("content-type") ?? "application/json";
  if (!contentType.includes("text/event-stream")) {
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { "content-type": contentType } });
  }

  // Pipe the SSE stream straight to the client.
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

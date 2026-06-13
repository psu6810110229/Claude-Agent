import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_PORT = process.env.CLAUDE_AGENT_PORT ?? "8787";
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;

// The idle follow-up runs a full AI turn (up to CLAUDE_BRIEF_TIMEOUT_MS), so —
// like /api/chat — it needs an explicit proxy with a generous timeout instead
// of the default Next rewrite, which would abort first. Fails QUIET: any error
// returns kind:"silent" with 200, never an error the user must handle.
const CHAT_PROXY_TIMEOUT_MS = Number(
  process.env.CLAUDE_AGENT_CHAT_PROXY_TIMEOUT_MS ?? 95_000,
);

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();
  let res: Response;
  try {
    res = await fetch(`${BACKEND_ORIGIN}/api/chat/followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body || "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(CHAT_PROXY_TIMEOUT_MS),
    });
  } catch {
    // A nudge must never disrupt — degrade to silent.
    return NextResponse.json({ kind: "silent" }, { status: 200 });
  }

  const responseBody = await res.text();
  return new Response(responseBody, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_PORT = process.env.CLAUDE_AGENT_PORT ?? "8787";
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();
  let res: Response;
  try {
    res = await fetch(`${BACKEND_ORIGIN}/api/chat/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      {
        kind: "error",
        error: "Cannot reach the backend.",
      },
      { status: 502 },
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

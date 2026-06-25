import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_PORT = process.env.CLAUDE_AGENT_PORT ?? "8787";
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;

// Parsing a timetable runs an image/PDF through Gemini vision and can take a
// while — longer than the default Next rewrite proxy tolerates. This explicit
// handler (for the POST that triggers extraction) applies its own generous
// timeout so the browser gets the result instead of a proxy 500. The GET/:id,
// PATCH item, and approve sub-paths are fast and fall through to the rewrite.
const IMPORT_PROXY_TIMEOUT_MS = Number(
  process.env.CLAUDE_AGENT_IMPORT_PROXY_TIMEOUT_MS ?? 120_000,
);

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();
  let res: Response;
  try {
    res = await fetch(`${BACKEND_ORIGIN}/api/schedule-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(IMPORT_PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return NextResponse.json(
      {
        error: timedOut
          ? "อ่านไฟล์นานเกินไป ลองไฟล์ที่เล็กลงหรือชัดขึ้น"
          : "ติดต่อ backend ไม่ได้",
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

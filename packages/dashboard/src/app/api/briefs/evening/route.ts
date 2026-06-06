import { proxyBriefRequest } from "../proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(): Promise<Response> {
  return proxyBriefRequest("evening");
}

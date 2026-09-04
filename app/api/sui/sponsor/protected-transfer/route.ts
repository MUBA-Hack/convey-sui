import { NextResponse } from "next/server";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";
import { createSponsoredProtectedTransfer } from "@/lib/sui/enoki-sponsor.server";

const MAX_REQUEST_BYTES = 96 * 1024;

export async function POST(request: Request) {
  const raw = await readBoundedUtf8Body(request, MAX_REQUEST_BYTES);
  if (raw === null) {
    return NextResponse.json(
      { kind: "unavailable", reason: "not_allowed" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { kind: "unavailable", reason: "not_allowed" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await createSponsoredProtectedTransfer({
    request: body,
    nowMs: Date.now(),
    env: process.env,
  });
  return NextResponse.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

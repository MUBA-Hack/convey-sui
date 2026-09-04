import { NextResponse } from "next/server";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";
import { executeSponsoredTransaction } from "@/lib/sui/enoki-sponsor.server";
import { SponsoredExecuteRequestSchema } from "@/lib/sui/sponsored-transaction";

const MAX_REQUEST_BYTES = 6 * 1024;

export async function POST(request: Request) {
  const raw = await readBoundedUtf8Body(request, MAX_REQUEST_BYTES);
  if (raw === null) {
    return NextResponse.json(
      { kind: "unavailable", reason: "invalid_request" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { kind: "unavailable", reason: "invalid_request" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const parsed = SponsoredExecuteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { kind: "unavailable", reason: "invalid_request" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await executeSponsoredTransaction({
    ...parsed.data,
    env: process.env,
  });
  return NextResponse.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

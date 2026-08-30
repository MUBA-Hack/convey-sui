import { NextResponse } from "next/server";
import { verifyRemittanceQuote } from "@/lib/remittance/quote-verification.server";

/**
 * POST /api/remittance/quote/verify
 *
 * Thin route around the server-only `verifyRemittanceQuote` evaluator. The
 * route only derives evidence mode from `?evidence=1`, parses JSON with the
 * invalid-JSON fallback below, calls the evaluator with the live clock and
 * env, and serializes the result. The full verification policy lives in
 * `lib/remittance/quote-verification.server.ts`.
 *
 * Fail closed: any validation failure returns 200 with `kind: "rejected"` and
 * a safe reason. No secret, signature, or HMAC detail is exposed.
 */

export async function POST(req: Request) {
  const evidenceMode =
    new URL(req.url, "http://localhost").searchParams.get("evidence") === "1";

  // Invalid JSON fails closed: the evaluator's strict parse rejects null as
  // invalid_envelope.
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // Leave body as null; the evaluator fails closed.
  }

  const result = verifyRemittanceQuote({
    body,
    evidenceMode,
    nowMs: Date.now(),
    env: process.env,
  });

  return NextResponse.json(result, { status: 200 });
}

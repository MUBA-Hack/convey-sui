import { NextResponse } from "next/server";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";
import {
  PROTECTED_TRANSFER_OPEN_MAX_BYTES,
  ProtectedTransferOpenRequestSchema,
  ProtectedTransferOpenResponseSchema,
  type ProtectedTransferOpenResponse,
} from "@/lib/remittance/protected-transfer-open";
import { readProtectedTransferOpenOnSui } from "@/lib/remittance/protected-transfer-terminal.server";
import {
  acquireProtectedTransferTerminalGate,
  releaseProtectedTransferTerminalGate,
} from "@/lib/remittance/protected-transfer-terminal-gate.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function response(body: ProtectedTransferOpenResponse) {
  return NextResponse.json(ProtectedTransferOpenResponseSchema.parse(body), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

/**
 * Strict content-type check. Accepts `application/json` with at most one
 * optional UTF-8 charset parameter; rejects every other media type, parameter,
 * missing header, or malformed value before any byte is read.
 */
function isApplicationJson(contentType: string | null): boolean {
  if (typeof contentType !== "string") return false;
  return /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
    contentType,
  );
}

export async function POST(req: Request) {
  if (!isApplicationJson(req.headers.get("content-type"))) {
    return response({ kind: "rejected", reason: "invalid_request" });
  }
  const raw = await readBoundedUtf8Body(req, PROTECTED_TRANSFER_OPEN_MAX_BYTES);
  if (raw === null) return response({ kind: "rejected", reason: "invalid_request" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return response({ kind: "rejected", reason: "invalid_request" });
  }
  const parsed = ProtectedTransferOpenRequestSchema.safeParse(body);
  if (!parsed.success) return response({ kind: "rejected", reason: "invalid_request" });

  // Shared in-memory rate + concurrency bound on the fixed testnet RPC seam.
  // A denied admission maps to the safe unavailable arm; the RPC is never
  // called when the gate denies.
  const outcome = acquireProtectedTransferTerminalGate();
  if (outcome !== "accepted") {
    return response({ kind: "unavailable", reason: "rpc_unavailable" });
  }
  try {
    return response(await readProtectedTransferOpenOnSui(parsed.data));
  } finally {
    releaseProtectedTransferTerminalGate();
  }
}

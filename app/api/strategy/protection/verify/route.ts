import { NextResponse } from "next/server";
import { parseBoundedJsonRequest } from "@/lib/http/parse-bounded-json-request.server";
import {
  PROTECTION_PURCHASE_VERIFY_MAX_BYTES,
  ProtectionPurchaseVerifyRequestSchema,
  ProtectionPurchaseVerifyResponseSchema,
  type ProtectionPurchaseVerifyResponse,
} from "@/lib/strategy/protection-purchase-receipt";
import { verifyProtectionPurchaseOnBase } from "@/lib/strategy/protection-purchase-verification.server";
import {
  acquireStrategyBaseGate,
  releaseStrategyBaseGate,
} from "@/lib/strategy/strategy-base-gate.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function response(body: ProtectionPurchaseVerifyResponse) {
  return NextResponse.json(ProtectionPurchaseVerifyResponseSchema.parse(body), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(request: Request) {
  const body = await parseBoundedJsonRequest(
    request,
    PROTECTION_PURCHASE_VERIFY_MAX_BYTES,
  );
  if (!body.ok) {
    return response({ kind: "rejected", reason: "invalid_request" });
  }
  const parsed = ProtectionPurchaseVerifyRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return response({ kind: "rejected", reason: "invalid_request" });
  }

  if (acquireStrategyBaseGate() !== "accepted") {
    return response({ kind: "unavailable", reason: "rpc_unavailable" });
  }
  try {
    return response(await verifyProtectionPurchaseOnBase(parsed.data));
  } catch {
    return response({ kind: "unavailable", reason: "rpc_unavailable" });
  } finally {
    releaseStrategyBaseGate();
  }
}

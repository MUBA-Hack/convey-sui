import { NextResponse } from "next/server";
import { parseBoundedJsonRequest } from "@/lib/http/parse-bounded-json-request.server";
import {
  PROTECTION_PURCHASE_MAX_BODY_BYTES,
  ProtectionPurchasePlanRequestSchema,
  ProtectionPurchasePlanResponseSchema,
  type ProtectionPurchasePlanResponse,
} from "@/lib/strategy/protection-purchase";
import {
  acquireStrategyBaseGate,
  releaseStrategyBaseGate,
} from "@/lib/strategy/strategy-base-gate.server";
import { prepareProtectionPurchasePlan } from "@/lib/strategy/thetanuts-purchase.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function response(body: ProtectionPurchasePlanResponse) {
  return NextResponse.json(ProtectionPurchasePlanResponseSchema.parse(body), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

function rejected(): ProtectionPurchasePlanResponse {
  return { kind: "rejected", reason: "invalid_request", checkedAt: new Date().toISOString() };
}

export async function POST(request: Request) {
  const body = await parseBoundedJsonRequest(
    request,
    PROTECTION_PURCHASE_MAX_BODY_BYTES,
  );
  if (!body.ok) return response(rejected());
  const parsed = ProtectionPurchasePlanRequestSchema.safeParse(body.value);
  if (!parsed.success) return response(rejected());
  if (acquireStrategyBaseGate() !== "accepted") {
    return response({ kind: "unavailable", checkedAt: new Date().toISOString() });
  }
  try {
    try {
      return response(await prepareProtectionPurchasePlan(parsed.data, { nowMs: Date.now() }));
    } catch {
      return response({ kind: "unavailable", checkedAt: new Date().toISOString() });
    }
  } finally {
    releaseStrategyBaseGate();
  }
}

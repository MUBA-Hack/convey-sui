import { NextResponse } from "next/server";
import {
  AI_DECISION_RECEIPT_VERIFY_MAX_BYTES,
  AiDecisionReceiptVerificationSchema,
  AiDecisionReceiptVerifyRequestSchema,
} from "@/lib/activity/ai-decision-receipt";
import { fetchPublicGonkaReceipt } from "@/lib/gonka/public-receipt";
import { parseBoundedJsonRequest } from "@/lib/http/parse-bounded-json-request.server";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function providerFailureKind(error: unknown): "mismatch" | "not_found" | "unavailable" {
  if (!(error instanceof Error)) return "unavailable";
  if (error.message === "Gonka receipt lookup failed with 404.") return "not_found";
  if (error.message === "Gonka receipt request id mismatch.") return "mismatch";
  return "unavailable";
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseBoundedJsonRequest(
    request,
    AI_DECISION_RECEIPT_VERIFY_MAX_BYTES,
  );
  if (!body.ok) return response({ kind: "unavailable" }, 400);
  const parsed = AiDecisionReceiptVerifyRequestSchema.safeParse(body.value);
  if (!parsed.success) return response({ kind: "unavailable" }, 400);

  try {
    const receipt = await fetchPublicGonkaReceipt(parsed.data.requestId);
    if (receipt.model !== parsed.data.expectedModel) {
      return response(
        AiDecisionReceiptVerificationSchema.parse({
          kind: "mismatch",
          fields: ["model"],
        }),
      );
    }
    return response(
      AiDecisionReceiptVerificationSchema.parse({
        kind: "verified",
        receipt: {
          requestId: receipt.x_request_id,
          model: receipt.model,
          nodeId: receipt.x_devshard_id,
          timestamp: receipt.created_at,
          outcome: receipt.outcome,
          statusCode: receipt.status_code,
          stream: receipt.stream,
          totalTokens: receipt.total_tokens,
          ttftMs: receipt.ttft_ms,
          durationMs: receipt.duration_ms,
        },
      }),
    );
  } catch (error) {
    const kind = providerFailureKind(error);
    return kind === "mismatch"
      ? response({ kind, fields: ["request_id"] })
      : response({ kind });
  }
}

import { NextResponse } from "next/server";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";
import { verifyRemittanceQuote } from "@/lib/remittance/quote-verification.server";
import { resolveProtectedTransferConfig } from "@/lib/remittance/protected-transfer-config.server";
import {
  PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS,
  PROTECTED_TRANSFER_PLAN_MAX_BYTES,
  ProtectedTransferPlanRequestSchema,
  parseProtectedTransferExecutionPlan,
  type ProtectedTransferExecutionPlan,
  type ProtectedTransferPlanResponse,
} from "@/lib/remittance/protected-transfer";
import type { VerifyRejected } from "@/lib/remittance/quote-schema";

/**
 * POST /api/remittance/protected-transfer/plan
 *
 * Returns a Protected Transfer execution plan over a single response channel.
 * "Server-issued" means response-channel provenance only: the returned plan is
 * unsigned and unattested, and this endpoint cannot prove package deployment,
 * immutability, or on-chain state. The client supplies only an attested quote
 * envelope, a deadline preset, and a review note. The server verifies the quote
 * through the single shared `verifyRemittanceQuote` policy, resolves the
 * protected package/reviewer from server-only env, computes the exact deadline,
 * and normalizes the candidate plan through the shared
 * `parseProtectedTransferExecutionPlan` parser used by the transaction builder.
 *
 * No client package ID, reviewer address, deadline timestamp, module, function,
 * Clock, coin type, cap, hash, version, sender, transaction bytes, or signer
 * input is accepted. No transaction construction or RPC happens here. Expected
 * request, config, and verification outcomes are HTTP 200 with
 * `Cache-Control: no-store` and the strict safe response union; a programmer
 * exception is not hidden behind a 200. Fail closed with a safe reason from the
 * existing vocabulary on any validation failure.
 */

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function reject(reason: VerifyRejected["reason"]): ProtectedTransferPlanResponse {
  return { kind: "rejected", reason };
}

function response(body: ProtectedTransferPlanResponse) {
  return NextResponse.json(body, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(req: Request) {
  // Shared transport reader owns Content-Length grammar, byte cap, declared/
  // actual equality, read/cancel rejection, and fatal UTF-8. A null transport
  // result fails closed as invalid_envelope.
  const raw = await readBoundedUtf8Body(req, PROTECTED_TRANSFER_PLAN_MAX_BYTES);
  if (raw === null) {
    return response(reject("invalid_envelope"));
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return response(reject("invalid_envelope"));
  }

  // Strict top-level request parse; missing quote or extra fields fail closed.
  const parsedRequest = ProtectedTransferPlanRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return response(reject("invalid_envelope"));
  }
  const request = parsedRequest.data;

  // Capture the server clock exactly once; the verifier and the preset
  // computation share this single value. Unsafe time is owned by the verifier.
  const nowMs = Date.now();

  // Verify the quote through the single shared policy (normal mode — never
  // evidence mode). The verifier is authoritative for the quote envelope,
  // unsafe time, and freshness.
  const quoteResult = verifyRemittanceQuote({
    body: request.quote,
    evidenceMode: false,
    nowMs,
    env: process.env,
  });

  if (quoteResult.kind === "rejected") {
    return response(quoteResult);
  }

  // Normal mode never returns historical evidence; an impossible
  // non-authorization result fails closed as unverified.
  if (quoteResult.kind !== "authorization") {
    return response(reject("unverified"));
  }
  const authorization = quoteResult;

  // Server-only config; absent or invalid fails closed as not_configured.
  const configResult = resolveProtectedTransferConfig(process.env);
  if (!configResult.ok) {
    return response(reject("not_configured"));
  }
  const { packageId, reviewerAddress, reviewerName } = configResult.config;

  // Preset deadline. Deadline safety and window are owned by the shared parser.
  const duration = PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS[request.deadlinePreset];
  const deadlineMs = nowMs + duration;

  // The candidate plan carries server-resolved package/reviewer and the raw
  // note; the shared parser normalizes the note and enforces all invariants.
  const candidatePlan: ProtectedTransferExecutionPlan = {
    kind: "protected_transfer_execution_plan",
    authorization,
    packageId,
    reviewerAddress,
    reviewerName,
    deadlineMs,
    reviewNote: request.reviewNote,
  };

  // Normalize through the shared parser; any failure fails closed.
  let normalizedPlan: ProtectedTransferExecutionPlan;
  try {
    normalizedPlan = parseProtectedTransferExecutionPlan(candidatePlan, nowMs);
  } catch {
    return response(reject("invalid_envelope"));
  }

  return response(normalizedPlan);
}

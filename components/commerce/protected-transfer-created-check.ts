import type { ProtectedTransferCreatedReceiptDocument } from "@/lib/remittance/protected-transfer-created-receipt";
import {
  ProtectedTransferCreatedVerifyResponseSchema,
  type ProtectedTransferCreatedVerifyRequest,
} from "@/lib/remittance/protected-transfer-created";
import type { CreatedCheckState } from "./proof-advanced-details";

function makeRequest(
  receipt: ProtectedTransferCreatedReceiptDocument,
): ProtectedTransferCreatedVerifyRequest {
  const transfer = receipt.transfer;
  return {
    digest: transfer.digest,
    payerAddress: transfer.payerAddress,
    beneficiaryAddress: transfer.beneficiaryAddress,
    amountMicro: transfer.amountMicro,
    deadlineMs: transfer.deadlineMs,
    evidenceCommitmentHex: transfer.evidenceCommitmentHex,
  };
}

function mapResponse(body: unknown): CreatedCheckState {
  const parsed = ProtectedTransferCreatedVerifyResponseSchema.safeParse(body);
  if (!parsed.success) return { status: "error" };
  if (parsed.data.kind === "verified") return { status: "verified" };
  if (parsed.data.kind === "not_found") return { status: "not_found" };
  if (parsed.data.kind === "unavailable") return { status: "unavailable" };
  return { status: "rejected" };
}

async function readResponse(response: Response): Promise<CreatedCheckState> {
  if (!response.ok) return { status: "unavailable" };
  try {
    return mapResponse(await response.json());
  } catch {
    return { status: "error" };
  }
}

export async function checkProtectedTransferCreatedReceipt(
  receipt: ProtectedTransferCreatedReceiptDocument,
  signal: AbortSignal,
): Promise<CreatedCheckState> {
  try {
    const response = await fetch("/api/remittance/protected-transfer/created/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRequest(receipt)),
      signal,
    });
    return await readResponse(response);
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: "unavailable" };
  }
}

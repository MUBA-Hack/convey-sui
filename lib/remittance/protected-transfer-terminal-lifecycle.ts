/**
 * Protected Transfer terminal lifecycle adapter — client-safe.
 *
 * Resolves the live lifecycle of a carried terminal receipt (`?t=...`) by
 * decoding and self-checking the receipt, then independently rerunning the
 * fixed-testnet Created-event, terminal-event, and when needed exact open-object
 * verification through the existing strict client adapters. The carried
 * receipt is never trusted as fresh chain state.
 *
 * Closed result union: `pending | verified | rejected | unavailable`.
 *
 * - `pending`: the Created event and exact shared escrow object are freshly
 *   verified and bound after the carried terminal digest is not found.
 * - `verified`: both fresh checks return `verified` and every bound field
 *   matches the carried receipt exactly.
 * - `rejected`: the receipt is invalid, a check rejected, the escrow is not
 *   open, or a fresh result does not bind to the receipt.
 * - `unavailable`: a required check was unavailable or malformed.
 *
 * TRUTH BOUNDARY: This adapter never claims the escrow is currently open from
 * carried data or terminal-digest absence. `pending` additionally requires a
 * fresh exact open-object read, including full held balance.
 */
import {
  type ProtectedTransferCreatedVerifyRequest,
  type ProtectedTransferCreatedVerifyResponse,
} from "./protected-transfer-created";
import {
  type ProtectedTransferOpenRequest,
  type ProtectedTransferOpenResponse,
} from "./protected-transfer-open";
import {
  type ProtectedTransferTerminalVerifyRequest,
  type ProtectedTransferTerminalVerifyResponse,
} from "./protected-transfer-terminal";
import {
  decodeProtectedTransferTerminalReceiptPayload,
  type ProtectedTransferTerminalReceiptDocument,
} from "./protected-transfer-terminal-receipt";
import {
  requestProtectedTransferCreatedVerification,
  requestProtectedTransferOpen,
  requestProtectedTransferTerminalVerification,
} from "./protected-transfer-client";

export type ProtectedTransferTerminalLifecycleRejectedReason =
  | "invalid_receipt"
  | "created_rejected"
  | "terminal_rejected"
  | "open_rejected"
  | "not_open"
  | "mismatch";

export type ProtectedTransferTerminalLifecycleResult =
  | {
      kind: "pending";
      created: Extract<ProtectedTransferCreatedVerifyResponse, { kind: "verified" }>;
      open: Extract<ProtectedTransferOpenResponse, { kind: "open" }>;
    }
  | {
      kind: "verified";
      created: Extract<ProtectedTransferCreatedVerifyResponse, { kind: "verified" }>;
      terminal: Extract<ProtectedTransferTerminalVerifyResponse, { kind: "verified" }>;
      receipt: ProtectedTransferTerminalReceiptDocument;
    }
  | {
      kind: "rejected";
      reason: ProtectedTransferTerminalLifecycleRejectedReason;
    }
  | { kind: "unavailable" };

export interface ResolveProtectedTransferTerminalLifecycleInput {
  /** URL-safe base64url payload carried in the `t` query parameter. */
  payload: string;
  fetchImpl?: typeof fetch;
  createdEndpoint?: string;
  terminalEndpoint?: string;
  openEndpoint?: string;
}

type VerifiedCreated = Extract<ProtectedTransferCreatedVerifyResponse, { kind: "verified" }>;
type VerifiedTerminal = Extract<ProtectedTransferTerminalVerifyResponse, { kind: "verified" }>;
type VerifiedOpen = Extract<ProtectedTransferOpenResponse, { kind: "open" }>;

/**
 * Bind a fresh Created response to the carried receipt's Created block. Every
 * field that the receipt carries must match exactly; any mismatch fails closed
 * as `mismatch`.
 */
function createdMatchesReceipt(
  fresh: VerifiedCreated,
  receipt: ProtectedTransferTerminalReceiptDocument,
): boolean {
  const carried = receipt.created.created;
  return (
    fresh.digest === carried.digest &&
    fresh.escrowObjectId === carried.escrowObjectId &&
    fresh.payerAddress === carried.payerAddress &&
    fresh.beneficiaryAddress === carried.beneficiaryAddress &&
    fresh.reviewer.name === carried.reviewer.name &&
    fresh.reviewer.address === carried.reviewer.address &&
    fresh.coinType === carried.coinType &&
    fresh.amountMicro === carried.amountMicro &&
    fresh.deadlineMs === carried.deadlineMs &&
    fresh.evidenceCommitmentHex === carried.evidenceCommitmentHex
  );
}

/**
 * Bind a fresh terminal response to the carried receipt's terminal block.
 */
function terminalMatchesReceipt(
  fresh: VerifiedTerminal,
  receipt: ProtectedTransferTerminalReceiptDocument,
): boolean {
  const carried = receipt.terminal;
  return (
    fresh.action === carried.action &&
    fresh.digest === carried.digest &&
    fresh.escrowObjectId === carried.escrowObjectId &&
    fresh.actorAddress === carried.actorAddress &&
    fresh.payerAddress === carried.payerAddress &&
    fresh.beneficiaryAddress === carried.beneficiaryAddress &&
    fresh.reviewerAddress === carried.reviewerAddress &&
    fresh.coinType === carried.coinType &&
    fresh.amountMicro === carried.amountMicro &&
    fresh.deadlineMs === carried.deadlineMs &&
    fresh.evidenceCommitmentHex === carried.evidenceCommitmentHex
  );
}

function openMatchesReceipt(
  fresh: VerifiedOpen,
  receipt: ProtectedTransferTerminalReceiptDocument,
): boolean {
  const carried = receipt.transfer;
  return (
    fresh.escrowObjectId === carried.escrowObjectId &&
    fresh.packageId === carried.packageId &&
    fresh.payerAddress === carried.payerAddress &&
    fresh.beneficiaryAddress === carried.beneficiaryAddress &&
    fresh.reviewerAddress === carried.reviewerAddress &&
    fresh.coinType === carried.coinType &&
    fresh.amountMicro === carried.amountMicro &&
    fresh.deadlineMs === carried.deadlineMs &&
    fresh.evidenceCommitmentHex === carried.evidenceCommitmentHex &&
    fresh.heldBalanceMicro === carried.amountMicro
  );
}

function buildCreatedRequest(
  receipt: ProtectedTransferTerminalReceiptDocument,
): ProtectedTransferCreatedVerifyRequest {
  const c = receipt.created.created;
  return {
    digest: c.digest,
    payerAddress: c.payerAddress,
    beneficiaryAddress: c.beneficiaryAddress,
    amountMicro: c.amountMicro,
    deadlineMs: c.deadlineMs,
    evidenceCommitmentHex: c.evidenceCommitmentHex,
  };
}

function buildTerminalRequest(
  receipt: ProtectedTransferTerminalReceiptDocument,
): ProtectedTransferTerminalVerifyRequest {
  const t = receipt.terminal;
  return {
    action: t.action,
    digest: t.digest,
    packageId: receipt.transfer.packageId,
    escrowObjectId: t.escrowObjectId,
    payerAddress: t.payerAddress,
    beneficiaryAddress: t.beneficiaryAddress,
    reviewerAddress: t.reviewerAddress,
    amountMicro: t.amountMicro,
    deadlineMs: t.deadlineMs,
    evidenceCommitmentHex: t.evidenceCommitmentHex,
  };
}

function buildOpenRequest(
  receipt: ProtectedTransferTerminalReceiptDocument,
): ProtectedTransferOpenRequest {
  const transfer = receipt.transfer;
  return {
    escrowObjectId: transfer.escrowObjectId,
    packageId: transfer.packageId,
    payerAddress: transfer.payerAddress,
    beneficiaryAddress: transfer.beneficiaryAddress,
    reviewerAddress: transfer.reviewerAddress,
    amountMicro: transfer.amountMicro,
    deadlineMs: transfer.deadlineMs,
    evidenceCommitmentHex: transfer.evidenceCommitmentHex,
  };
}

async function resolvePendingOpen(
  receipt: ProtectedTransferTerminalReceiptDocument,
  created: VerifiedCreated,
  input: ResolveProtectedTransferTerminalLifecycleInput,
): Promise<ProtectedTransferTerminalLifecycleResult> {
  let response: ProtectedTransferOpenResponse;
  try {
    const result = await requestProtectedTransferOpen({
      request: buildOpenRequest(receipt),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.openEndpoint ? { endpoint: input.openEndpoint } : {}),
    });
    response = result.response;
  } catch {
    return { kind: "unavailable" };
  }

  if (response.kind === "unavailable") return { kind: "unavailable" };
  if (response.kind === "terminal_unknown") {
    return { kind: "rejected", reason: "not_open" };
  }
  if (response.kind === "rejected") {
    return { kind: "rejected", reason: "open_rejected" };
  }
  if (!openMatchesReceipt(response, receipt)) {
    return { kind: "rejected", reason: "mismatch" };
  }
  return { kind: "pending", created, open: response };
}

/**
 * Resolve the live lifecycle of a carried terminal receipt. Never throws for
 * untrusted input or transport failure; every failure maps to the closed union.
 */
export async function resolveProtectedTransferTerminalLifecycle(
  input: ResolveProtectedTransferTerminalLifecycleInput,
): Promise<ProtectedTransferTerminalLifecycleResult> {
  if (!input || typeof input.payload !== "string" || input.payload.length === 0) {
    return { kind: "rejected", reason: "invalid_receipt" };
  }

  let receipt: ProtectedTransferTerminalReceiptDocument;
  try {
    receipt = decodeProtectedTransferTerminalReceiptPayload(input.payload);
  } catch {
    return { kind: "rejected", reason: "invalid_receipt" };
  }

  // Run both independent fresh checks in parallel. Each client adapter throws
  // on a malformed/unsafe response; a throw maps to `unavailable`.
  let createdResponse: ProtectedTransferCreatedVerifyResponse;
  let terminalResponse: ProtectedTransferTerminalVerifyResponse;
  try {
    const [createdResult, terminalResult] = await Promise.all([
      requestProtectedTransferCreatedVerification({
        request: buildCreatedRequest(receipt),
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        ...(input.createdEndpoint ? { endpoint: input.createdEndpoint } : {}),
      }),
      requestProtectedTransferTerminalVerification({
        request: buildTerminalRequest(receipt),
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        ...(input.terminalEndpoint ? { endpoint: input.terminalEndpoint } : {}),
      }),
    ]);
    createdResponse = createdResult.response;
    terminalResponse = terminalResult.response;
  } catch {
    return { kind: "unavailable" };
  }
  if (createdResponse.kind === "unavailable" || terminalResponse.kind === "unavailable") {
    return { kind: "unavailable" };
  }

  if (createdResponse.kind === "rejected" || createdResponse.kind === "not_found") {
    return { kind: "rejected", reason: "created_rejected" };
  }

  if (!createdMatchesReceipt(createdResponse, receipt)) {
    return { kind: "rejected", reason: "mismatch" };
  }

  if (terminalResponse.kind === "not_found") {
    return resolvePendingOpen(receipt, createdResponse, input);
  }
  if (terminalResponse.kind === "rejected") {
    return { kind: "rejected", reason: "terminal_rejected" };
  }
  if (!terminalMatchesReceipt(terminalResponse, receipt)) {
    return { kind: "rejected", reason: "mismatch" };
  }

  return {
    kind: "verified",
    created: createdResponse,
    terminal: terminalResponse,
    receipt,
  };
}

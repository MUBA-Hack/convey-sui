/**
 * Protected Transfer terminal receipt — strict minimal portable document.
 *
 * Binds the original ProtectedTransferCreatedReceipt plus a verified terminal
 * response and `exportedAt`. Every terminal field/outcome is bound to the
 * Created fields and the plan (package/roles/amount/deadline/commitment/
 * escrow). Query param `t`, bounded JSON, URL-safe payload. No claim stronger
 * than carried evidence; reopening UI independently reruns both checks later.
 *
 * TRUTH BOUNDARY: This unsigned carried JSON establishes only internal
 * consistency between its terminal response, Created receipt, and transfer
 * fields. It does not itself prove that a chain event occurred, and it is not
 * durable chain evidence, payout evidence, or a live verification of later
 * on-chain state. Existing receipt types are unchanged.
 */
import { isValidSuiAddress, isValidTransactionDigest, normalizeSuiAddress } from "@mysten/sui/utils";
import { z } from "zod";
import { USDC_COIN_TYPE_TESTNET } from "./constants";
import {
  parseProtectedTransferExecutionPlan,
  type ProtectedTransferExecutionPlan,
} from "./protected-transfer";
import {
  ProtectedTransferCreatedReceiptSchema,
  type ProtectedTransferCreatedReceiptDocument,
} from "./protected-transfer-created-receipt";
import {
  ProtectedTransferTerminalActionSchema,
  ProtectedTransferTerminalVerifyResponseSchema,
  type ProtectedTransferTerminalAction,
} from "./protected-transfer-terminal";
import { buildExplorerUrl } from "./transfer";

export const PROTECTED_TRANSFER_TERMINAL_RECEIPT_KIND =
  "convey.protected-transfer-terminal-receipt" as const;
export const PROTECTED_TRANSFER_TERMINAL_RECEIPT_VERSION = 1 as const;
export const PROTECTED_TRANSFER_TERMINAL_RECEIPT_QUERY_PARAM = "t" as const;
export const PROTECTED_TRANSFER_TERMINAL_RECEIPT_MAX_BYTES = 20 * 1024;
export const PROTECTED_TRANSFER_TERMINAL_RECEIPT_MAX_PAYLOAD_LENGTH = 28_672;

const VerifiedTerminalResponseSchema =
  ProtectedTransferTerminalVerifyResponseSchema.options[0];
export type VerifiedProtectedTransferTerminalResponse = z.infer<
  typeof VerifiedTerminalResponseSchema
>;

const CanonicalSuiAddressSchema = z.string().refine(
  (value) => isValidSuiAddress(value) && normalizeSuiAddress(value) === value,
  "Expected a canonical Sui address.",
);

export const ProtectedTransferTerminalReceiptTermsSchema = z.strictObject({
  action: ProtectedTransferTerminalActionSchema,
  digest: z.string().refine(isValidTransactionDigest),
  explorerUrl: z.url().max(200),
  escrowObjectId: CanonicalSuiAddressSchema,
  actorAddress: CanonicalSuiAddressSchema,
  payerAddress: CanonicalSuiAddressSchema,
  beneficiaryAddress: CanonicalSuiAddressSchema,
  reviewerAddress: CanonicalSuiAddressSchema,
  packageId: CanonicalSuiAddressSchema,
  coinType: z.literal(USDC_COIN_TYPE_TESTNET),
  amountMicro: z.string().regex(/^[1-9]\d*$/),
  deadlineMs: z.number().int().safe().positive(),
  evidenceCommitmentHex: z.string().regex(/^0x[0-9a-f]{64}$/),
  terminalCheckedAt: z.iso.datetime(),
});
export type ProtectedTransferTerminalReceiptTerms = z.infer<
  typeof ProtectedTransferTerminalReceiptTermsSchema
>;

export const ProtectedTransferTerminalReceiptSchema = z
  .strictObject({
    kind: z.literal(PROTECTED_TRANSFER_TERMINAL_RECEIPT_KIND),
    version: z.literal(PROTECTED_TRANSFER_TERMINAL_RECEIPT_VERSION),
    created: ProtectedTransferCreatedReceiptSchema,
    terminal: VerifiedTerminalResponseSchema,
    transfer: ProtectedTransferTerminalReceiptTermsSchema,
    exportedAt: z.iso.datetime(),
  })
  .superRefine((document, context) => {
    const created = document.created;
    const terminal = document.terminal;
    const transfer = document.transfer;

    // Bind terminal response to Created receipt fields.
    const createdBindings: ReadonlyArray<{
      field: keyof ProtectedTransferTerminalReceiptTerms;
      actual: unknown;
      expected: unknown;
    }> = [
      { field: "escrowObjectId", actual: transfer.escrowObjectId, expected: created.transfer.escrowObjectId },
      { field: "payerAddress", actual: transfer.payerAddress, expected: created.transfer.payerAddress },
      { field: "beneficiaryAddress", actual: transfer.beneficiaryAddress, expected: created.transfer.beneficiaryAddress },
      { field: "reviewerAddress", actual: transfer.reviewerAddress, expected: created.transfer.reviewerAddress },
      { field: "packageId", actual: transfer.packageId, expected: created.transfer.packageId },
      { field: "coinType", actual: transfer.coinType, expected: created.transfer.coinType },
      { field: "amountMicro", actual: transfer.amountMicro, expected: created.transfer.amountMicro },
      { field: "deadlineMs", actual: transfer.deadlineMs, expected: created.transfer.deadlineMs },
      {
        field: "evidenceCommitmentHex",
        actual: transfer.evidenceCommitmentHex,
        expected: created.transfer.evidenceCommitmentHex,
      },
    ];
    for (const binding of createdBindings) {
      if (binding.actual !== binding.expected) {
        context.addIssue({
          code: "custom",
          path: ["transfer", binding.field],
          message: `${String(binding.field)} must match the Created receipt.`,
        });
      }
    }

    // Bind terminal response fields to the transfer terms.
    const terminalBindings: ReadonlyArray<{
      field: keyof ProtectedTransferTerminalReceiptTerms;
      actual: unknown;
      expected: unknown;
    }> = [
      { field: "action", actual: transfer.action, expected: terminal.action },
      { field: "digest", actual: transfer.digest, expected: terminal.digest },
      { field: "escrowObjectId", actual: transfer.escrowObjectId, expected: terminal.escrowObjectId },
      { field: "actorAddress", actual: transfer.actorAddress, expected: terminal.actorAddress },
      { field: "payerAddress", actual: transfer.payerAddress, expected: terminal.payerAddress },
      { field: "beneficiaryAddress", actual: transfer.beneficiaryAddress, expected: terminal.beneficiaryAddress },
      { field: "reviewerAddress", actual: transfer.reviewerAddress, expected: terminal.reviewerAddress },
      { field: "coinType", actual: transfer.coinType, expected: terminal.coinType },
      { field: "amountMicro", actual: transfer.amountMicro, expected: terminal.amountMicro },
      { field: "deadlineMs", actual: transfer.deadlineMs, expected: terminal.deadlineMs },
      {
        field: "evidenceCommitmentHex",
        actual: transfer.evidenceCommitmentHex,
        expected: terminal.evidenceCommitmentHex,
      },
      { field: "terminalCheckedAt", actual: transfer.terminalCheckedAt, expected: terminal.checkedAt },
    ];
    for (const binding of terminalBindings) {
      if (binding.actual !== binding.expected) {
        context.addIssue({
          code: "custom",
          path: ["transfer", binding.field],
          message: `${String(binding.field)} must match the independently checked terminal response.`,
        });
      }
    }

    // Actor must match the action: reviewer for release, payer for refund.
    const expectedActor =
      terminal.action === "release" ? terminal.reviewerAddress : terminal.payerAddress;
    if (transfer.actorAddress !== expectedActor) {
      context.addIssue({
        code: "custom",
        path: ["transfer", "actorAddress"],
        message: "Actor must be the reviewer for release or the payer for refund.",
      });
    }

    if (transfer.explorerUrl !== buildExplorerUrl(terminal.digest)) {
      context.addIssue({
        code: "custom",
        path: ["transfer", "explorerUrl"],
        message: "Explorer URL must match the terminal transaction digest on Sui testnet.",
      });
    }
    if (Date.parse(document.exportedAt) < Date.parse(terminal.checkedAt)) {
      context.addIssue({
        code: "custom",
        path: ["exportedAt"],
        message: "exportedAt cannot precede the terminal-event check.",
      });
    }
    if (Date.parse(terminal.checkedAt) < Date.parse(created.created.checkedAt)) {
      context.addIssue({
        code: "custom",
        path: ["terminal", "checkedAt"],
        message: "Terminal check cannot precede the Created check.",
      });
    }

    // Re-derive the plan commitment and bind it to the carried commitment.
    try {
      const plan = parseProtectedTransferExecutionPlan(
        created.plan,
        created.plan.authorization.issuedAt,
      );
      if (plan.packageId !== transfer.packageId) {
        context.addIssue({
          code: "custom",
          path: ["transfer", "packageId"],
          message: "Package must match the strict execution plan.",
        });
      }
      if (plan.reviewerAddress !== transfer.reviewerAddress) {
        context.addIssue({
          code: "custom",
          path: ["transfer", "reviewerAddress"],
          message: "Reviewer must match the strict execution plan.",
        });
      }
      if (plan.deadlineMs !== transfer.deadlineMs) {
        context.addIssue({
          code: "custom",
          path: ["transfer", "deadlineMs"],
          message: "Deadline must match the strict execution plan.",
        });
      }
      if (plan.authorization.recipientAddress !== transfer.beneficiaryAddress) {
        context.addIssue({
          code: "custom",
          path: ["transfer", "beneficiaryAddress"],
          message: "Beneficiary must match the strict execution plan.",
        });
      }
      if (plan.authorization.usdcMicro !== transfer.amountMicro) {
        context.addIssue({
          code: "custom",
          path: ["transfer", "amountMicro"],
          message: "Amount must match the strict execution plan.",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["created", "plan"],
        message: "Carried execution plan cannot be re-derived.",
      });
    }
  });

export type ProtectedTransferTerminalReceiptDocument = z.infer<
  typeof ProtectedTransferTerminalReceiptSchema
>;

export interface BuildProtectedTransferTerminalReceiptInput {
  createdReceipt: ProtectedTransferCreatedReceiptDocument;
  terminal: VerifiedProtectedTransferTerminalResponse;
  exportedAt?: string;
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Protected Transfer terminal receipt ${label} does not match.`);
  }
}

export function buildProtectedTransferTerminalReceipt(
  input: BuildProtectedTransferTerminalReceiptInput,
): ProtectedTransferTerminalReceiptDocument {
  const created = ProtectedTransferCreatedReceiptSchema.parse(input.createdReceipt);
  const terminal = VerifiedTerminalResponseSchema.parse(input.terminal);

  // Bind terminal to Created fields before constructing terms.
  assertEqual("escrowObjectId", terminal.escrowObjectId, created.transfer.escrowObjectId);
  assertEqual("payerAddress", terminal.payerAddress, created.transfer.payerAddress);
  assertEqual("beneficiaryAddress", terminal.beneficiaryAddress, created.transfer.beneficiaryAddress);
  assertEqual("reviewerAddress", terminal.reviewerAddress, created.transfer.reviewerAddress);
  assertEqual("coinType", terminal.coinType, created.transfer.coinType);
  assertEqual("amountMicro", terminal.amountMicro, created.transfer.amountMicro);
  assertEqual("deadlineMs", terminal.deadlineMs, created.transfer.deadlineMs);
  assertEqual("evidenceCommitmentHex", terminal.evidenceCommitmentHex, created.transfer.evidenceCommitmentHex);

  const expectedActor =
    terminal.action === "release" ? terminal.reviewerAddress : terminal.payerAddress;
  assertEqual("actorAddress", terminal.actorAddress, expectedActor);

  const exportedAt = input.exportedAt ?? new Date().toISOString();
  if (Date.parse(exportedAt) < Date.parse(terminal.checkedAt)) {
    throw new Error("Protected Transfer terminal receipt exportedAt cannot precede the terminal check.");
  }
  if (Date.parse(terminal.checkedAt) < Date.parse(created.created.checkedAt)) {
    throw new Error("Protected Transfer terminal receipt terminal check cannot precede the Created check.");
  }

  return ProtectedTransferTerminalReceiptSchema.parse({
    kind: PROTECTED_TRANSFER_TERMINAL_RECEIPT_KIND,
    version: PROTECTED_TRANSFER_TERMINAL_RECEIPT_VERSION,
    created,
    terminal,
    transfer: {
      action: terminal.action,
      digest: terminal.digest,
      explorerUrl: buildExplorerUrl(terminal.digest),
      escrowObjectId: terminal.escrowObjectId,
      actorAddress: terminal.actorAddress,
      payerAddress: terminal.payerAddress,
      beneficiaryAddress: terminal.beneficiaryAddress,
      reviewerAddress: terminal.reviewerAddress,
      packageId: created.transfer.packageId,
      coinType: terminal.coinType,
      amountMicro: terminal.amountMicro,
      deadlineMs: terminal.deadlineMs,
      evidenceCommitmentHex: terminal.evidenceCommitmentHex,
      terminalCheckedAt: terminal.checkedAt,
    },
    exportedAt,
  });
}

export interface VerifiedProtectedTransferTerminalReceipt {
  ok: true;
  kind: "protected_transfer_terminal";
  claim: string;
  document: ProtectedTransferTerminalReceiptDocument;
}

export interface InvalidProtectedTransferTerminalReceipt {
  ok: false;
  errors: string[];
}

export type ProtectedTransferTerminalReceiptResult =
  | VerifiedProtectedTransferTerminalReceipt
  | InvalidProtectedTransferTerminalReceipt;

function formatIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string[] {
  return issues.map((issue) => {
    const field = issue.path.length ? `${issue.path.map(String).join(".")}: ` : "";
    return `${field}${issue.message}`;
  });
}

export function verifyProtectedTransferTerminalReceipt(
  input: unknown,
): ProtectedTransferTerminalReceiptResult {
  let candidate = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > PROTECTED_TRANSFER_TERMINAL_RECEIPT_MAX_BYTES) {
      return { ok: false, errors: ["Protected Transfer terminal receipt is too large."] };
    }
    try {
      candidate = JSON.parse(input);
    } catch {
      return { ok: false, errors: ["Protected Transfer terminal receipt JSON could not be parsed."] };
    }
  }
  const parsed = ProtectedTransferTerminalReceiptSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error.issues) };
  return {
    ok: true,
    kind: "protected_transfer_terminal",
    claim:
      "Terminal event fields are bound to a prior terminal verification response and the carried Created receipt (self-consistency only). " +
      "This page has not repeated either independent Sui check; later on-chain state is outside this receipt.",
    document: parsed.data,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(payload: string): Uint8Array {
  if (
    typeof payload !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(payload) ||
    payload.length % 4 === 1 ||
    payload.length > PROTECTED_TRANSFER_TERMINAL_RECEIPT_MAX_PAYLOAD_LENGTH
  ) {
    throw new Error("Protected Transfer terminal receipt payload is malformed or too large.");
  }
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bytes = Uint8Array.from(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
      (character) => character.charCodeAt(0),
    );
    if (bytes.byteLength > PROTECTED_TRANSFER_TERMINAL_RECEIPT_MAX_BYTES) {
      throw new Error("Protected Transfer terminal receipt payload is too large.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error && /too large/i.test(error.message)) throw error;
    throw new Error("Protected Transfer terminal receipt payload could not be decoded.");
  }
}

export function encodeProtectedTransferTerminalReceiptPayload(
  document: ProtectedTransferTerminalReceiptDocument,
): string {
  const parsed = ProtectedTransferTerminalReceiptSchema.parse(document);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed));
  if (bytes.byteLength > PROTECTED_TRANSFER_TERMINAL_RECEIPT_MAX_BYTES) {
    throw new Error("Protected Transfer terminal receipt payload is too large.");
  }
  return bytesToBase64Url(bytes);
}

export function decodeProtectedTransferTerminalReceiptPayload(
  payload: string,
): ProtectedTransferTerminalReceiptDocument {
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(payload));
  } catch (error) {
    if (error instanceof Error && /payload/i.test(error.message)) throw error;
    throw new Error("Protected Transfer terminal receipt payload is invalid.");
  }
  try {
    return ProtectedTransferTerminalReceiptSchema.parse(JSON.parse(json));
  } catch {
    throw new Error("Protected Transfer terminal receipt payload is invalid.");
  }
}

export type { ProtectedTransferExecutionPlan, ProtectedTransferTerminalAction };

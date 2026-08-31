"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { Transaction } from "@mysten/sui/transactions";
import {
  useCurrentAccount,
  useCurrentNetwork,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import type { QuoteEnvelope } from "@/lib/remittance/quote";
import {
  buildProtectedTransfer,
  PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS,
  type ProtectedTransferDeadlinePreset,
  type ProtectedTransferExecutionPlan,
  type ProtectedTransferMetadata,
} from "@/lib/remittance/protected-transfer";
import {
  requestProtectedTransferPlan,
  requestProtectedTransferCreatedVerification,
} from "@/lib/remittance/protected-transfer-client";
import {
  buildProtectedTransferCreatedReceipt,
  encodeProtectedTransferCreatedReceiptPayload,
  PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM,
  type ProtectedTransferCreatedReceiptDocument,
  type VerifiedProtectedTransferCreatedResponse,
} from "@/lib/remittance/protected-transfer-created-receipt";
import type { ProtectedTransferCreatedVerifyRequest } from "@/lib/remittance/protected-transfer-created";
import {
  buildExplorerUrl,
  extractSuccessfulDigest,
  isTypedWalletRejection,
} from "@/lib/remittance/transfer";
import { recordActivity } from "@/lib/activity/storage";
import { formatUsdcGrouped } from "@/lib/remittance/money";

export const NOT_CONFIGURED_COPY =
  "Family review isn't available right now. Send directly to continue.";
const GENERIC_HOLD_ERROR = "Family review couldn't be started. Send directly to continue.";

type Plan = ProtectedTransferExecutionPlan & { reviewerName?: string };

type HoldPhase =
  | { kind: "idle" }
  | { kind: "planning" }
  | {
      kind: "ready";
      plan: Plan;
      metadata: ProtectedTransferMetadata;
      transaction: Transaction;
    }
  | { kind: "confirming"; plan: Plan; metadata: ProtectedTransferMetadata }
  | {
      kind: "submitted";
      plan: Plan;
      metadata: ProtectedTransferMetadata;
      digest: string;
    }
  | {
      kind: "verified";
      plan: Plan;
      metadata: ProtectedTransferMetadata;
      digest: string;
      receipt: ProtectedTransferCreatedReceiptDocument;
      receiptPayload: string;
    }
  | { kind: "unknown" }
  | { kind: "error"; message: string };

export interface FamilyReviewActionProps {
  quote: QuoteEnvelope;
  deadlinePreset: ProtectedTransferDeadlinePreset;
  note: string;
  onNoteInvalid: (message: string | null) => void;
  /**
   * Optional custody manifest digest (lowercase 0x + 64 hex). When present it
   * is forwarded into the Protected Transfer plan request as
   * `custodyManifestDigest`; the server preserves it after quote verification
   * and the builder binds it into the outer commitment. Ordinary transfers
   * omit it and preserve canonical behavior.
   */
  custodyManifestDigest?: string;
}

function validateNote(note: string): string | null {
  const trimmed = note.trim();
  if (trimmed.length === 0) return "Add a short note for your family reviewer.";
  if (Array.from(trimmed).length > PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS) {
    return "Keep the note to 120 characters.";
  }
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f))) {
      return "Enter a short note for the reviewer.";
    }
  }
  return null;
}

export function useFamilyReviewSubmit({
  quote,
  deadlinePreset,
  note,
  onNoteInvalid,
  custodyManifestDigest,
}: FamilyReviewActionProps) {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const dAppKit = useDAppKit();
  const [phase, setPhase] = useState<HoldPhase>({ kind: "idle" });
  const lockRef = useRef(false);
  const verifySeq = useRef(0);

  const busy = phase.kind === "planning" || phase.kind === "confirming";
  // Once planning begins the hold lane is committed: path radios, note, edit,
  // carry, and the compact CTAs stay locked through settlement. `hold-approve`
  // stays clickable only in the `ready` step (explicit wallet approval).
  const locked =
    busy ||
    phase.kind === "ready" ||
    phase.kind === "submitted" ||
    phase.kind === "verified" ||
    phase.kind === "unknown";
  const holdApproveDisabled = phase.kind !== "ready";

  async function submit() {
    if (lockRef.current) return;
    const noteProblem = validateNote(note);
    if (noteProblem) {
      onNoteInvalid(noteProblem);
      return;
    }
    onNoteInvalid(null);
    if (!account?.address || network !== "testnet") {
      setPhase({ kind: "error", message: GENERIC_HOLD_ERROR });
      return;
    }

    lockRef.current = true;
    setPhase({ kind: "planning" });

    try {
      const result = await requestProtectedTransferPlan({
        request: {
          quote,
          deadlinePreset,
          reviewNote: note.trim(),
          ...(custodyManifestDigest === undefined
            ? {}
            : { custodyManifestDigest }),
        },
      });
      if (result.response.kind === "rejected") {
        lockRef.current = false;
        setPhase({
          kind: "error",
          message:
            result.response.reason === "not_configured"
              ? NOT_CONFIGURED_COPY
              : GENERIC_HOLD_ERROR,
        });
        return;
      }

      const plan = result.response;
      const built = buildProtectedTransfer({
        plan,
        sender: account.address,
        nowMs: Date.now(),
      });
      // Step 1 ends here: plan resolved, summary shown, no wallet invocation.
      // Step 2 (hold-approve) is an explicit, separate user action.
      setPhase({ kind: "ready", plan, metadata: built.metadata, transaction: built.transaction });
    } catch {
      lockRef.current = false;
      setPhase({ kind: "error", message: GENERIC_HOLD_ERROR });
    }
  }

  async function approve(
    transaction: Transaction,
    plan: Plan,
    metadata: ProtectedTransferMetadata,
  ) {
    setPhase({ kind: "confirming", plan, metadata });
    try {
      const walletResult = await dAppKit.signAndExecuteTransaction({ transaction });
      const digest = extractSuccessfulDigest(walletResult);
      if (!digest) {
        setPhase({ kind: "unknown" });
        return;
      }
      setPhase({ kind: "submitted", plan, metadata, digest });
      void verifyCreated(plan, metadata, digest);
    } catch (error) {
      if (isTypedWalletRejection(error)) {
        lockRef.current = false;
        setPhase({ kind: "ready", plan, metadata, transaction });
        return;
      }
      // Any non-rejection failure after signing began is treated as unknown —
      // the wallet may have broadcast without returning a digest we can prove.
      setPhase({ kind: "unknown" });
    }
  }

  async function verifyCreated(
    plan: Plan,
    metadata: ProtectedTransferMetadata,
    digest: string,
  ) {
    const seq = ++verifySeq.current;
    const expectation: ProtectedTransferCreatedVerifyRequest = {
      digest,
      payerAddress: metadata.sender,
      beneficiaryAddress: metadata.beneficiary,
      amountMicro: metadata.amountMicro,
      deadlineMs: metadata.deadlineMs,
      evidenceCommitmentHex: metadata.commitmentHex,
    };
    try {
      const result = await requestProtectedTransferCreatedVerification({
        request: expectation,
      });
      if (verifySeq.current !== seq) return;
      if (result.response.kind !== "verified") return;
      const receipt = buildProtectedTransferCreatedReceipt({
        verification: result.response as VerifiedProtectedTransferCreatedResponse,
        plan,
        metadata,
      });
      const receiptPayload = encodeProtectedTransferCreatedReceiptPayload(receipt);
      setPhase({ kind: "verified", plan, metadata, digest, receipt, receiptPayload });
      const recipient = plan.authorization.recipient;
      const reviewer = plan.reviewerName ?? "family";
      const city = plan.authorization.destinationCity;
      recordActivity({
        id: `protected_transfer:${digest}`,
        href: `/proof?${PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM}=${receiptPayload}`,
        title: `Hold for ${recipient}`,
        amountLabel: `${formatUsdcGrouped(metadata.amountMicro)} USDC`,
        detailLabel: `${city} · ${reviewer}`,
        nextOwner: reviewer,
        updatedAt: receipt.exportedAt,
      });
    } catch {
      // A failed independent check never downgrades the submitted hold state.
      // The hold remains pending confirmation; the customer can reopen it later.
    }
  }

  const primaryLabel =
    phase.kind === "planning"
      ? "Preparing hold…"
      : phase.kind === "confirming"
        ? "Confirm in your wallet"
        : phase.kind === "submitted"
          ? "Hold submitted — confirmation pending"
          : phase.kind === "verified"
            ? "Held for family review"
            : phase.kind === "unknown"
              ? "Outcome unknown — check wallet and explorer"
              : "Hold for family review";

  return {
    phase,
    busy,
    locked,
    holdApproveDisabled,
    submit,
    approveFromReady: () => {
      if (phase.kind !== "ready") return;
      void approve(phase.transaction, phase.plan, phase.metadata);
    },
    primaryLabel,
  };
}

export function FamilyReviewStatus({ phase }: { phase: HoldPhase }) {
  if (phase.kind === "error") {
    return (
      <p
        data-testid="family-review-error"
        className="mb-2 text-[11px] leading-relaxed text-neutral-700"
        role="alert"
      >
        {phase.message}
      </p>
    );
  }
  if (phase.kind === "submitted") {
    return (
      <div className="mb-2 space-y-1" data-testid="family-review-status">
        <p className="text-[11px] leading-relaxed text-neutral-700" aria-live="polite">
          Hold submitted — confirmation pending
        </p>
        <a
          href={buildExplorerUrl(phase.digest)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="family-review-explorer"
          className="inline-flex min-h-11 items-center text-[11px] font-medium text-black underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
          View on Sui Explorer
        </a>
      </div>
    );
  }
  if (phase.kind === "verified") {
    const href = `/proof?${PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM}=${phase.receiptPayload}`;
    return (
      <div className="mb-2 space-y-1" data-testid="family-review-status">
        <p className="text-[11px] leading-relaxed text-neutral-700" aria-live="polite">
          Held for {phase.plan.reviewerName ?? "family"}’s review
        </p>
        <Link
          href={href}
          data-testid="family-review-open-receipt"
          className="inline-flex min-h-11 items-center text-[11px] font-medium text-black underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
          Open receipt
        </Link>
      </div>
    );
  }
  if (phase.kind === "unknown") {
    return (
      <p
        data-testid="family-review-status"
        className="mb-2 text-[11px] leading-relaxed text-neutral-700"
        role="alert"
      >
        Outcome unknown — check wallet and explorer
      </p>
    );
  }
  if (phase.kind === "confirming") {
    return (
      <p className="sr-only" aria-live="polite">
        Confirm in your wallet
      </p>
    );
  }
  return null;
}

"use client";

import { useRef, useState } from "react";
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
} from "@/lib/remittance/protected-transfer";
import { requestProtectedTransferPlan } from "@/lib/remittance/protected-transfer-client";
import {
  buildExplorerUrl,
  extractSuccessfulDigest,
  isTypedWalletRejection,
} from "@/lib/remittance/transfer";

export const NOT_CONFIGURED_COPY =
  "Family review isn't available right now. Send directly to continue.";
const GENERIC_HOLD_ERROR = "Family review couldn't be started. Send directly to continue.";

type HoldPhase =
  | { kind: "idle" }
  | { kind: "planning" }
  | { kind: "confirming" }
  | { kind: "submitted"; digest: string }
  | { kind: "unknown" }
  | { kind: "error"; message: string };

export interface FamilyReviewActionProps {
  quote: QuoteEnvelope;
  deadlinePreset: ProtectedTransferDeadlinePreset;
  note: string;
  onNoteInvalid: (message: string | null) => void;
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
}: FamilyReviewActionProps) {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const dAppKit = useDAppKit();
  const [phase, setPhase] = useState<HoldPhase>({ kind: "idle" });
  const lockRef = useRef(false);

  const busy = phase.kind === "planning" || phase.kind === "confirming";
  const locked = busy || phase.kind === "submitted" || phase.kind === "unknown";

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
    let signingBegan = false;

    try {
      const result = await requestProtectedTransferPlan({
        request: {
          quote,
          deadlinePreset,
          reviewNote: note.trim(),
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

      const built = buildProtectedTransfer({
        plan: result.response,
        sender: account.address,
        nowMs: Date.now(),
      });
      signingBegan = true;
      setPhase({ kind: "confirming" });
      const walletResult = await dAppKit.signAndExecuteTransaction({
        transaction: built.transaction,
      });
      const digest = extractSuccessfulDigest(walletResult);
      if (!digest) {
        setPhase({ kind: "unknown" });
        return;
      }
      setPhase({ kind: "submitted", digest });
    } catch (error) {
      if (isTypedWalletRejection(error)) {
        lockRef.current = false;
        setPhase({ kind: "idle" });
        return;
      }
      if (signingBegan) {
        setPhase({ kind: "unknown" });
        return;
      }
      lockRef.current = false;
      setPhase({ kind: "error", message: GENERIC_HOLD_ERROR });
    }
  }

  const primaryLabel =
    phase.kind === "planning"
      ? "Preparing hold…"
      : phase.kind === "confirming"
        ? "Confirm in your wallet"
        : phase.kind === "submitted"
          ? "Hold submitted — confirmation pending"
          : phase.kind === "unknown"
            ? "Outcome unknown — check wallet and explorer"
            : "Hold for family review";

  return { phase, busy, locked, submit, primaryLabel };
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

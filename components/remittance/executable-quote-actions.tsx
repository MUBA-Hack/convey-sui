"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Edit2 } from "@/components/icons";
import { formatMyr, type QuoteEnvelope } from "@/lib/remittance/quote";
import { titleCaseCity } from "@/lib/remittance/quote-form";
import type { ProtectedTransferDeadlinePreset } from "@/lib/remittance/protected-transfer";
import { FamilyReviewSelection, type SendPath } from "./family-review-path";
import { FamilyReviewSummary } from "./family-review-summary";
import {
  FamilyReviewStatus,
  useFamilyReviewSubmit,
} from "./family-review-action";

function buildEthHedgeHref(quote: QuoteEnvelope): string {
  const params = new URLSearchParams({
    source: "remittance",
    amountMyr: formatMyr(quote.youPayMinor),
    recipient: quote.recipient,
    city: titleCaseCity(quote.destinationCity),
  });
  return `/strategy?${params.toString()}`;
}

export function SecondaryQuoteActions({
  quote,
  onCarry,
  disabled = false,
}: {
  quote: QuoteEnvelope;
  onCarry: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 flex flex-col items-center gap-1.5 text-[11px] text-neutral-500">
      <button
        type="button"
        data-testid="carry-to-device"
        className="inline-flex min-h-9 items-center text-[11px] font-medium underline-offset-4 hover:text-neutral-800 hover:underline disabled:pointer-events-none disabled:opacity-50"
        onClick={onCarry}
        disabled={disabled}
      >
        Carry to another device
      </button>
      <Link
        href={buildEthHedgeHref(quote)}
        data-testid="preview-eth-hedge"
        className="inline-flex min-h-9 items-center text-[11px] font-medium underline-offset-4 hover:text-neutral-800 hover:underline"
      >
        Explore separate ETH treasury protection
      </Link>
    </div>
  );
}

function QuoteSecondaryRow({
  editable,
  onEdit,
  onDismiss,
  disabled,
}: {
  editable: boolean;
  onEdit: () => void;
  onDismiss: () => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-2 flex gap-2">
      {editable && (
        <button
          type="button"
          data-testid="edit-transfer"
          data-hit-target="true"
          className="cv-btn-ghost inline-flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold uppercase tracking-[0.12em] sm:px-4"
          onClick={onEdit}
          disabled={disabled}
          aria-label="Edit details"
        >
          <Edit2 size={15} variant="Linear" />
          <span className="sm:hidden">Edit</span>
          <span className="hidden sm:inline">Edit details</span>
        </button>
      )}
      <button
        type="button"
        data-hit-target="true"
        className="cv-btn-ghost inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
        onClick={onDismiss}
        disabled={disabled}
      >
        Dismiss
      </button>
    </div>
  );
}

function HoldPrimary({
  quote,
  deadlinePreset,
  note,
  onNoteInvalid,
  onEdit,
  onDismiss,
  editable,
  handoffEligible,
  onCarry,
  onLockChange,
}: {
  quote: QuoteEnvelope;
  deadlinePreset: ProtectedTransferDeadlinePreset;
  note: string;
  onNoteInvalid: (message: string | null) => void;
  onEdit: () => void;
  onDismiss: () => void;
  editable: boolean;
  handoffEligible: boolean;
  onCarry: () => void;
  onLockChange: (locked: boolean) => void;
}) {
  const hold = useFamilyReviewSubmit({
    quote,
    deadlinePreset,
    note,
    onNoteInvalid,
  });
  useEffect(() => {
    onLockChange(hold.locked);
    return () => onLockChange(false);
  }, [hold.locked, onLockChange]);

  const phase = hold.phase;
  const showSummary =
    phase.kind === "ready" ||
    phase.kind === "confirming" ||
    phase.kind === "submitted" ||
    phase.kind === "verified";
  const showCompact =
    phase.kind === "idle" ||
    phase.kind === "planning" ||
    phase.kind === "error" ||
    phase.kind === "unknown";

  return (
    <>
      <FamilyReviewStatus phase={hold.phase} />
      {showSummary && (
        <FamilyReviewSummary plan={phase.plan} metadata={phase.metadata} />
      )}
      {showCompact ? (
        <button
          type="button"
          data-testid="hold-prepare"
          data-hit-target="true"
          className="cv-btn-solid inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={() => void hold.submit()}
          disabled={hold.locked}
          aria-busy={hold.busy}
        >
          {phase.kind === "planning" ? "Preparing hold…" : "Hold for family review"}
        </button>
      ) : (
        <button
          type="button"
          data-testid="hold-approve"
          data-hit-target="true"
          className="cv-btn-solid inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={() => hold.approveFromReady()}
          disabled={hold.holdApproveDisabled}
          aria-busy={hold.busy}
        >
          {hold.primaryLabel}
        </button>
      )}
      <QuoteSecondaryRow
        editable={editable}
        onEdit={onEdit}
        onDismiss={onDismiss}
        disabled={hold.locked}
      />
      {handoffEligible && (
        <SecondaryQuoteActions quote={quote} onCarry={onCarry} disabled={hold.locked} />
      )}
    </>
  );
}

export function ExecutableQuoteActions({
  quote,
  confirmLabel,
  onConfirm,
  onEdit,
  onDismiss,
  handoffEligible,
  onCarry,
  editable,
}: {
  quote: QuoteEnvelope;
  confirmLabel?: string;
  onConfirm: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  handoffEligible: boolean;
  onCarry: () => void;
  editable: boolean;
}) {
  const [path, setPath] = useState<SendPath>("direct");
  const [deadlinePreset, setDeadlinePreset] =
    useState<ProtectedTransferDeadlinePreset>("tomorrow");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [holdLocked, setHoldLocked] = useState(false);

  return (
    <div className="border-t border-black/8 p-4">
      <FamilyReviewSelection
        path={path}
        deadlinePreset={deadlinePreset}
        note={note}
        noteError={noteError}
        disabled={holdLocked}
        onPathChange={setPath}
        onDeadlineChange={setDeadlinePreset}
        onNoteChange={(value) => {
          setNote(value);
          setNoteError(null);
        }}
      />
      {path === "hold" ? (
        <HoldPrimary
          quote={quote}
          deadlinePreset={deadlinePreset}
          note={note}
          onNoteInvalid={(message) => {
            setNoteError(
              message && note.trim().length === 0
                ? "Add a short note for your family reviewer."
                : message,
            );
          }}
          onEdit={onEdit}
          onDismiss={onDismiss}
          editable={editable}
          handoffEligible={handoffEligible}
          onCarry={onCarry}
          onLockChange={setHoldLocked}
        />
      ) : (
        <>
          <button
            type="button"
            data-testid="review-transfer"
            data-hit-target="true"
            className="cv-btn-solid inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            onClick={onConfirm}
          >
            {confirmLabel ?? "Review transfer"}
          </button>
          <QuoteSecondaryRow
            editable={editable}
            onEdit={onEdit}
            onDismiss={onDismiss}
            disabled={false}
          />
          {handoffEligible && <SecondaryQuoteActions quote={quote} onCarry={onCarry} />}
        </>
      )}
    </div>
  );
}

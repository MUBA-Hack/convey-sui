"use client";

import { useEffect, useState } from "react";
import { Edit2 } from "@/components/icons";
import type { QuoteEnvelope } from "@/lib/remittance/quote";
import type { ProtectedTransferDeadlinePreset } from "@/lib/remittance/protected-transfer";
import {
  getProtectedTransferTemplate,
} from "@/lib/remittance/protected-transfer-template";
import { FamilyReviewSelection, type SendPath, type HoldPurpose } from "./family-review-path";
import { FamilyReviewSummary } from "./family-review-summary";
import {
  FamilyReviewStatus,
  useFamilyReviewSubmit,
} from "./family-review-action";

export function SecondaryQuoteActions({
  onCarry,
  disabled = false,
}: {
  onCarry: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 flex flex-col items-center gap-1.5 text-[11px] text-neutral-500">
      <button
        type="button"
        data-testid="carry-to-device"
        className="inline-flex min-h-11 items-center px-1 text-[11px] font-medium underline-offset-4 hover:text-neutral-800 hover:underline disabled:pointer-events-none disabled:opacity-50"
        onClick={onCarry}
        disabled={disabled}
      >
        Carry to another device
      </button>
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
  custodyManifestDigest,
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
  custodyManifestDigest?: string | null;
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
    // Only forward a real digest to the submit hook; null/undefined both
    // mean "no digest" at the request boundary so the canonical encoding
    // stays unchanged. The button-disable guard below handles the
    // medicine-required-but-missing case.
    ...(custodyManifestDigest === undefined || custodyManifestDigest === null
      ? {}
      : { custodyManifestDigest }),
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

  // When a custody manifest digest is required (medicine pickup) but none is
  // present yet, the hold cannot be prepared. The submit hook still owns the
  // note validation; this guard only blocks the button until a valid medicine
  // commitment exists.
  const custodyMissing =
    custodyManifestDigest !== undefined && custodyManifestDigest === null;
  const prepareDisabled = hold.locked || custodyMissing;

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
          disabled={prepareDisabled}
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
        <SecondaryQuoteActions onCarry={onCarry} disabled={hold.locked} />
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
  const [purpose, setPurpose] = useState<HoldPurpose>("family_support");
  // null = no commitment yet; string = valid digest; undefined = purpose does
  // not require one (family_support default). The hold CTA is disabled while
  // the medicine panel is open and no valid digest has been emitted.
  const [custodyDigest, setCustodyDigest] = useState<string | null | undefined>(
    undefined,
  );
  const [deadlinePreset, setDeadlinePreset] =
    useState<ProtectedTransferDeadlinePreset>("tomorrow");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [holdLocked, setHoldLocked] = useState(false);

  // When the purpose changes, reset the custody digest to match: medicine
  // requires a fresh commitment (null until the panel emits one); any other
  // purpose clears the requirement (undefined). Also reset the deadline to the
  // template default so the constrained preset set always shows a valid
  // selection.
  const handlePurposeChange = (next: HoldPurpose) => {
    setPurpose(next);
    setCustodyDigest(next === "medicine_pickup" ? null : undefined);
    const template = getProtectedTransferTemplate(next);
    if (template) setDeadlinePreset(template.defaultDeadlinePreset);
  };

  // The custody digest forwarded to the hold hook: only medicine_pickup
  // supplies one; every other purpose forwards undefined so the canonical
  // encoding and plan request stay byte-for-byte unchanged. When medicine is
  // chosen but no valid commitment exists yet, null is forwarded so the hold
  // CTA stays disabled until the panel emits a valid digest.
  const forwardedCustodyDigest =
    purpose === "medicine_pickup" ? custodyDigest : undefined;

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
        purpose={purpose}
        onPurposeChange={handlePurposeChange}
        onCustodyManifestDigestChange={(digest) => setCustodyDigest(digest)}
        beneficiaryRef={quote.beneficiaryRef}
        quoteIssuedAt={quote.issuedAt}
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
          custodyManifestDigest={forwardedCustodyDigest}
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
          {handoffEligible && <SecondaryQuoteActions onCarry={onCarry} />}
        </>
      )}
    </div>
  );
}

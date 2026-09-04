"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight2 } from "@/components/icons";
import type { ProtectedTransferDeadlinePreset } from "@/lib/remittance/protected-transfer";
import { PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS } from "@/lib/remittance/protected-transfer";
import {
  listProtectedTransferTemplates,
  type ProtectedTransferTemplate,
  type ProtectedTransferTemplateId,
} from "@/lib/remittance/protected-transfer-template";
import { MedicinePickupPanel } from "./medicine-pickup-panel";

export type SendPath = "direct" | "hold";

/**
 * Hold purpose chosen inside the hold path. `family_support` is the default
 * and preserves the existing canonical hold behavior (no custody digest).
 * `medicine_pickup` reveals the Medicine pickup panel and requires a valid
 * medicine order commitment before the hold can be prepared.
 */
export type HoldPurpose = ProtectedTransferTemplateId;

const PRESET_LABELS: Record<ProtectedTransferDeadlinePreset, string> = {
  tomorrow: "Tomorrow",
  three_days: "3 days",
  seven_days: "7 days",
};

const TEMPLATES: readonly ProtectedTransferTemplate[] =
  listProtectedTransferTemplates();

/** Compact hold-purpose choices shown only inside the hold path. */
const HOLD_PURPOSE_CHOICES: ReadonlyArray<{
  id: HoldPurpose;
  label: string;
}> = Object.freeze(
  TEMPLATES.map((t) => ({ id: t.id, label: t.customerLabel })),
);

export interface FamilyReviewSelectionProps {
  path: SendPath;
  deadlinePreset: ProtectedTransferDeadlinePreset;
  note: string;
  noteError: string | null;
  disabled: boolean;
  onPathChange: (path: SendPath) => void;
  onDeadlineChange: (preset: ProtectedTransferDeadlinePreset) => void;
  onNoteChange: (note: string) => void;
  /** Current hold purpose; defaults to family_support. */
  purpose: HoldPurpose;
  onPurposeChange: (purpose: HoldPurpose) => void;
  /** Emitted when the medicine panel prepares or invalidates a commitment. */
  onCustodyManifestDigestChange: (digest: string | null) => void;
  /**
   * Beneficiary reference threaded from the existing quote, used by the
   * Medicine pickup panel so the customer never enters or sees R-/ORD- schema
   * jargon. Required only when medicine_pickup is reachable.
   */
  beneficiaryRef: string;
  /**
   * Stable quote issuance timestamp (epoch ms) threaded from the existing
   * quote and used as the Medicine pickup panel's deterministic anchor
   * (`nowMs`). A signed quote must never default its pickup window to
   * `Date.now()`: the same quote yields the same window and commitment digest
   * across render times and devices.
   */
  quoteIssuedAt: number;
}

export function FamilyReviewSelection({
  path,
  deadlinePreset,
  note,
  noteError,
  disabled,
  onPathChange,
  onDeadlineChange,
  onNoteChange,
  purpose,
  onPurposeChange,
  onCustodyManifestDigestChange,
  beneficiaryRef,
  quoteIssuedAt,
}: FamilyReviewSelectionProps) {
  const pathName = useId();
  const deadlineName = useId();
  const noteId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const noteCount = Array.from(note.trim()).length;
  const showNote = noteOpen || Boolean(noteError) || note.length > 0;

  // Restrained reveal: opacity + y only (no layout-property animation, no
  // perpetual motion). Reduced motion zeroes the y offset so only opacity
  // transitions. Duration 200ms sits in the 180–220ms band.
  const reduceMotion = useReducedMotion();
  const revealY = reduceMotion ? 0 : 8;
  const revealTransition = { duration: 0.2, ease: "easeOut" as const };

  // The active template constrains the allowed deadline presets. When the
  // current preset is not allowed by the chosen purpose, the parent is
  // expected to reset it; here we only render the allowed subset.
  const activeTemplate =
    TEMPLATES.find((t) => t.id === purpose) ?? TEMPLATES[0]!;
  const allowedPresets = activeTemplate.allowedDeadlinePresets;

  useEffect(() => {
    if (showNote && noteError) {
      noteRef.current?.focus();
    }
  }, [showNote, noteError]);

  return (
    <div className="mb-2 space-y-2">
      <fieldset>
        <legend className="sr-only">How to send</legend>
        <div
          className={`flex h-11 w-full overflow-hidden rounded-lg border border-black/12 ${disabled ? "opacity-60" : ""}`}
        >
          <label
            className={`relative flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center px-2 text-center text-xs font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-black ${
              path === "direct" ? "bg-black text-white" : "bg-white text-neutral-700"
            } ${disabled ? "cursor-not-allowed" : ""}`}
          >
            <input
              type="radio"
              name={pathName}
              data-testid="send-path-direct"
              className="sr-only"
              checked={path === "direct"}
              disabled={disabled}
              onChange={() => {
                setNoteOpen(false);
                onPathChange("direct");
              }}
            />
            <span className="whitespace-nowrap">Send now</span>
          </label>
          <label
            className={`relative flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center border-l border-black/12 px-2 text-center text-xs font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-black ${
              path === "hold" ? "bg-black text-white" : "bg-white text-neutral-700"
            } ${disabled ? "cursor-not-allowed" : ""}`}
          >
            <input
              type="radio"
              name={pathName}
              data-testid="send-path-hold"
              className="sr-only"
              checked={path === "hold"}
              disabled={disabled}
              onChange={() => onPathChange("hold")}
            />
            <span className="whitespace-nowrap">Protect outcome</span>
          </label>
        </div>
      </fieldset>

      <AnimatePresence>
        {path === "hold" && (
          <motion.div
            key="hold-details"
            data-testid="hold-reveal-motion"
            initial={{ opacity: 0, y: revealY }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: revealY }}
            transition={revealTransition}
            className="space-y-2"
          >
          <p className="text-[11px] leading-snug text-neutral-600">
            Convey turns this request into a Sui agreement. Your reviewer
            releases it after the requested evidence is checked; expiry returns
            control to you.
          </p>
          {/* Compact hold-purpose choice. family_support is the default and
              preserves the canonical hold (no custody digest). medicine_pickup
              reveals the Medicine pickup panel and requires a valid commitment
              before the hold can be prepared. */}
          <fieldset
            data-testid="family-review-purpose"
            disabled={disabled}
            className="min-w-0"
          >
            <legend className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
              Purpose
            </legend>
            <div className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-3">
              {HOLD_PURPOSE_CHOICES.map((choice) => {
                const selected = purpose === choice.id;
                return (
                  <label
                    key={choice.id}
                    data-testid={`purpose-${choice.id}`}
                    className={`relative flex min-h-11 min-w-0 cursor-pointer items-center justify-center rounded-lg border border-black/12 px-2 text-center text-xs font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-black ${
                      selected ? "bg-black text-white" : "bg-white text-neutral-700"
                    } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <input
                      type="radio"
                      name="family-review-purpose"
                      className="sr-only"
                      checked={selected}
                      onChange={() => onPurposeChange(choice.id)}
                    />
                    {choice.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <AnimatePresence>
            {purpose === "medicine_pickup" && (
              <motion.div
                key="medicine-panel"
                data-testid="medicine-reveal-motion"
                initial={{ opacity: 0, y: revealY }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: revealY }}
                transition={revealTransition}
              >
                <MedicinePickupPanel
                  disabled={disabled}
                  beneficiaryRef={beneficiaryRef}
                  nowMs={quoteIssuedAt}
                  onCommitmentChange={(digest) =>
                    onCustodyManifestDigestChange(digest)
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>
          <fieldset
            data-testid="family-review-deadline"
            disabled={disabled}
            className="min-w-0"
          >
            <legend className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
              Hold until
            </legend>
            <div className="flex h-11 w-full overflow-hidden rounded-lg border border-black/12">
              {allowedPresets.map((preset) => {
                const selected = deadlinePreset === preset;
                return (
                  <label
                    key={preset}
                    data-testid={`family-review-deadline-${preset}`}
                    className={`relative flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center border-r border-black/12 text-xs font-medium last:border-r-0 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-black ${
                      selected ? "bg-black text-white" : "bg-white text-neutral-700"
                    } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <input
                      type="radio"
                      name={deadlineName}
                      className="sr-only"
                      checked={selected}
                      onChange={() => onDeadlineChange(preset)}
                    />
                    {PRESET_LABELS[preset]}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {showNote ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={noteId}
                  className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500"
                >
                  What should they check?
                </label>
                <span className="font-mono text-[10px] tabular-nums text-neutral-400">
                  {noteCount}/{PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS}
                </span>
              </div>
              <textarea
                id={noteId}
                ref={noteRef}
                data-testid="family-review-note"
                disabled={disabled}
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                rows={1}
                className="min-h-11 w-full resize-none rounded-lg border border-black/12 bg-white px-3 py-2 text-sm text-black outline-none focus-visible:ring-2 focus-visible:ring-black/40"
              />
              {noteError && (
                <p
                  data-testid="family-review-note-error"
                  className="text-[11px] text-neutral-700"
                  role="alert"
                >
                  {noteError}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              data-testid="family-review-add-note"
              disabled={disabled}
              className="flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-black/12 bg-white px-3 text-left text-sm text-black outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-black/40 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => setNoteOpen(true)}
            >
              <span>+ Add a note</span>
              <ArrowRight2
                size={14}
                variant="Linear"
                className="shrink-0 text-neutral-400"
              />
            </button>
          )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight2 } from "@/components/icons";
import type { ProtectedTransferDeadlinePreset } from "@/lib/remittance/protected-transfer";
import { PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS } from "@/lib/remittance/protected-transfer";

export type SendPath = "direct" | "hold";

const PRESET_LABELS: Record<ProtectedTransferDeadlinePreset, string> = {
  tomorrow: "Tomorrow",
  three_days: "3 days",
  seven_days: "7 days",
};

export interface FamilyReviewSelectionProps {
  path: SendPath;
  deadlinePreset: ProtectedTransferDeadlinePreset;
  note: string;
  noteError: string | null;
  disabled: boolean;
  onPathChange: (path: SendPath) => void;
  onDeadlineChange: (preset: ProtectedTransferDeadlinePreset) => void;
  onNoteChange: (note: string) => void;
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
}: FamilyReviewSelectionProps) {
  const pathName = useId();
  const deadlineName = useId();
  const noteId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const noteCount = Array.from(note.trim()).length;
  const showNote = noteOpen || Boolean(noteError) || note.length > 0;

  useEffect(() => {
    if (showNote && noteError) {
      noteRef.current?.focus();
    }
  }, [showNote, noteError]);

  return (
    <div className="mb-3 space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
          How to send
        </legend>
        <label
          className={`flex min-h-11 items-center gap-2.5 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
        >
          <input
            type="radio"
            name={pathName}
            data-testid="send-path-direct"
            className="size-4 accent-black"
            checked={path === "direct"}
            disabled={disabled}
            onChange={() => {
              setNoteOpen(false);
              onPathChange("direct");
            }}
          />
          <span className="text-sm text-black">Send directly</span>
        </label>
        <label
          className={`flex min-h-11 items-center gap-2.5 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
        >
          <input
            type="radio"
            name={pathName}
            data-testid="send-path-hold"
            className="size-4 accent-black"
            checked={path === "hold"}
            disabled={disabled}
            onChange={() => onPathChange("hold")}
          />
          <span className="text-sm text-black">Hold for family review</span>
        </label>
      </fieldset>

      {path === "hold" && (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-neutral-600">
            The transfer waits for someone in your family to check it. If they
            don’t, you can take it back after the deadline.
          </p>
          <fieldset
            data-testid="family-review-deadline"
            disabled={disabled}
            className="min-w-0"
          >
            <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
              Hold until
            </legend>
            <div className="flex h-11 w-full overflow-hidden rounded-lg border border-black/12">
              {(
                Object.keys(PRESET_LABELS) as ProtectedTransferDeadlinePreset[]
              ).map((preset) => {
                const selected = deadlinePreset === preset;
                return (
                  <label
                    key={preset}
                    data-testid={`family-review-deadline-${preset}`}
                    className={`flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center border-r border-black/12 text-xs font-medium last:border-r-0 ${
                      selected
                        ? "bg-black text-white"
                        : "bg-white text-neutral-700"
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
              <label
                htmlFor={noteId}
                className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500"
              >
                What should they check?
              </label>
              <textarea
                id={noteId}
                ref={noteRef}
                data-testid="family-review-note"
                disabled={disabled}
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                rows={2}
                className="min-h-11 w-full resize-none rounded-lg border border-black/12 bg-white px-3 py-2 text-sm text-black outline-none focus-visible:ring-2 focus-visible:ring-black/40"
              />
              <p className="text-[11px] text-neutral-500">
                {noteCount}/{PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS}
              </p>
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
              className="flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-black/12 bg-white px-3 text-left text-sm text-black outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-black/40 disabled:pointer-events-none disabled:opacity-50"
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
        </div>
      )}
    </div>
  );
}

"use client";

import { useId, useState } from "react";
import { Add, Copy, CopySuccess, Edit2, TickCircle, Trash } from "@/components/icons";
import { formatUsdc } from "@/lib/remittance/money";
import {
  SPLIT_MAX_PARTICIPANTS,
  SPLIT_MIN_PARTICIPANTS,
  SPLIT_NAME_MAX,
  equalSplit,
  formatSplitRequest,
  parseUsdcDecimalToMicro,
  validateAllocationMicro,
  validateSplitName,
  validateSplitTotal,
} from "@/lib/remittance/receipt-split";

/**
 * Inline "Split with friends" panel for a confirmed remittance receipt.
 *
 * Source of truth is the settlement `usdcMicro` integer minor units — never a
 * formatted money string. Equal split distributes the remainder
 * deterministically in input order so allocations sum exactly. Each row must
 * be explicitly confirmed before requests can be generated. Generated output
 * is copyable request text that says "request", never "paid", and carries no
 * wallet authority. Reset/collapse never mutates settlement evidence or
 * share/export behavior — all split state is local to this panel.
 */
export interface ReceiptSplitActionProps {
  usdcMicro: string;
  receiptUrl: string;
}

interface SplitRow {
  id: number;
  name: string;
  allocationInput: string;
  confirmed: boolean;
}

interface SplitState {
  rows: SplitRow[];
  nextRowId: number;
}

function createBlankRow(id: number): SplitRow {
  return { id, name: "", allocationInput: "", confirmed: false };
}

export function ReceiptSplitAction({
  usdcMicro,
  receiptUrl,
}: ReceiptSplitActionProps) {
  const headingId = useId();
  const [split, setSplit] = useState<SplitState>({
    rows: [createBlankRow(1), createBlankRow(2)],
    nextRowId: 3,
  });
  const rows = split.rows;
  const [generated, setGenerated] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const count = rows.length;
  const canAdd = count < SPLIT_MAX_PARTICIPANTS;
  const canRemove = count > SPLIT_MIN_PARTICIPANTS;

  // Per-row derived validation. Names compare against the OTHER rows' names.
  const rowState = rows.map((row, index) => {
    const otherNames = rows.filter((_, i) => i !== index).map((r) => r.name);
    const nameError = validateSplitName(row.name, otherNames);
    const parsed = parseUsdcDecimalToMicro(row.allocationInput);
    const allocationError =
      parsed.ok && row.allocationInput !== ""
        ? validateAllocationMicro(parsed.micro, usdcMicro)
        : parsed.ok
          ? "not_positive"
          : parsed.error === "too_many_decimals"
            ? "too_many_decimals"
            : row.allocationInput === ""
              ? "not_positive"
              : "malformed";
    const micro = parsed.ok ? parsed.micro : "";
    return { row, nameError, allocationError, micro, parsedOk: parsed.ok };
  });

  const micros = rowState.map((r) => r.micro);
  const allNamesValid = rowState.every((r) => r.nameError === null);
  const allAllocationsValid =
    rowState.every((r) => r.parsedOk && r.row.allocationInput !== "" && r.allocationError === null);
  const totalValid = validateSplitTotal(micros, usdcMicro);
  const allConfirmed = rowState.every((r) => r.row.confirmed);
  const canGenerate =
    allNamesValid &&
    allAllocationsValid &&
    totalValid &&
    allConfirmed &&
    count >= SPLIT_MIN_PARTICIPANTS &&
    count <= SPLIT_MAX_PARTICIPANTS;

  function updateRow(id: number, patch: Partial<SplitRow>) {
    setSplit((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
    setGenerated(false);
  }

  function handleSplitEqually() {
    const parts = equalSplit(usdcMicro, count);
    setSplit((prev) => ({
      ...prev,
      rows: prev.rows.map((row, i) => ({
        ...row,
        allocationInput: formatUsdc(parts[i]!),
        confirmed: false,
      })),
    }));
    setGenerated(false);
  }

  function handleAdd() {
    if (!canAdd) return;
    setSplit((prev) => ({
      rows: [...prev.rows, createBlankRow(prev.nextRowId)],
      nextRowId: prev.nextRowId + 1,
    }));
    setGenerated(false);
  }

  function handleRemove(id: number) {
    if (!canRemove) return;
    setSplit((prev) => ({
      ...prev,
      rows: prev.rows.filter((row) => row.id !== id),
    }));
    setGenerated(false);
  }

  function handleConfirm(id: number) {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const r = rowState[idx]!;
    if (r.nameError !== null || !r.parsedOk || r.row.allocationInput === "" || r.allocationError !== null) return;
    updateRow(id, { confirmed: true });
  }

  function handleEdit(id: number) {
    updateRow(id, { confirmed: false });
  }

  function handleReset() {
    setSplit((prev) => ({
      rows: [createBlankRow(prev.nextRowId), createBlankRow(prev.nextRowId + 1)],
      nextRowId: prev.nextRowId + 2,
    }));
    setGenerated(false);
    setCopiedIndex(null);
  }

  async function handleCopy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
    } catch {
      setCopiedIndex(null);
    }
  }

  const totalStatus = !allAllocationsValid
    ? "Enter a positive USDC amount for every participant."
    : !totalValid
      ? "Allocations do not match the receipt total."
      : allConfirmed
        ? "All rows confirmed."
        : "Confirm each row to generate requests.";

  return (
    <div
      data-testid="receipt-split-action"
      aria-labelledby={headingId}
      className="mt-3 space-y-3 rounded-xl border border-black/12 bg-white p-4 text-sm text-black"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600">
          Split with friends
        </h3>
        <span
          data-testid="split-source-total"
          className="font-mono tabular-nums text-xs text-neutral-700"
        >
          {formatUsdc(usdcMicro)} USDC
        </span>
      </div>

      <p className="text-xs text-neutral-600">
        Turn this confirmed transfer into copyable requests. No money is sent and no wallet is connected.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSplitEqually}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Split equally
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Add size="14" variant="Linear" aria-hidden="true" />
          Add participant
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Reset split
        </button>
      </div>

      <ul className="space-y-2">
        {rowState.map(({ row, nameError, allocationError }, index) => (
          <li
            key={row.id}
            data-testid="split-row"
            className="space-y-1.5 rounded-lg border border-black/10 p-2.5"
          >
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`split-name-${row.id}`}>
                Participant {index + 1} name
              </label>
              <input
                id={`split-name-${row.id}`}
                data-testid="split-name-input"
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder="Name"
                maxLength={SPLIT_NAME_MAX}
                value={row.name}
                readOnly={row.confirmed}
                onChange={(e) => updateRow(row.id, { name: e.target.value })}
                aria-invalid={nameError !== null}
                className="min-h-10 flex-1 rounded-md border border-black/15 bg-white px-2.5 text-sm text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black read-only:bg-neutral-50"
              />
              <label className="sr-only" htmlFor={`split-alloc-${row.id}`}>
                Participant {index + 1} USDC amount
              </label>
              <input
                id={`split-alloc-${row.id}`}
                data-testid="split-allocation-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={row.allocationInput}
                readOnly={row.confirmed}
                onChange={(e) => updateRow(row.id, { allocationInput: e.target.value })}
                aria-invalid={allocationError !== null}
                className="min-h-10 w-28 rounded-md border border-black/15 bg-white px-2.5 text-right font-mono text-sm text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black read-only:bg-neutral-50"
              />
              <span className="font-mono text-[11px] text-neutral-500">USDC</span>
              <button
                type="button"
                onClick={() => handleRemove(row.id)}
                disabled={!canRemove}
                aria-label={`Remove participant ${index + 1}`}
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-black/15 text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash size="14" variant="Linear" aria-hidden="true" />
              </button>
            </div>
            <div className="flex min-h-5 items-center justify-between gap-2 text-[11px]">
              <span className="text-neutral-600" data-testid="split-row-error">
                {nameError === "blank"
                  ? "Enter a name."
                  : nameError === "too_long"
                    ? "Name is too long."
                    : nameError === "duplicate"
                      ? "This name is already added."
                      : allocationError === "not_positive"
                        ? "Enter a positive USDC amount."
                        : allocationError === "overflow"
                          ? "Amount exceeds the receipt total."
                          : allocationError === "too_many_decimals"
                            ? "Use at most six decimals."
                            : allocationError === "malformed"
                              ? "Enter a valid USDC amount."
                              : ""}
              </span>
              {row.confirmed ? (
                <button
                  type="button"
                  onClick={() => handleEdit(row.id)}
                  aria-label={`Edit row ${index + 1}`}
                  className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-black underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                >
                  <Edit2 size="12" variant="Linear" aria-hidden="true" />
                  Edit row
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleConfirm(row.id)}
                  disabled={nameError !== null || allocationError !== null}
                  aria-label={`Confirm row ${index + 1}`}
                  className="inline-flex min-h-8 items-center gap-1 rounded-md border border-black/15 px-2 text-[11px] font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <TickCircle size="12" variant="Linear" aria-hidden="true" />
                  Confirm row
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p data-testid="split-total-status" className="text-[11px] text-neutral-600">
        {totalStatus}
      </p>

      <button
        type="button"
        onClick={() => setGenerated(true)}
        disabled={!canGenerate}
        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-black px-3 text-xs font-semibold text-white transition hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        Generate requests
      </button>

      {generated && (
        <ul className="space-y-2" data-testid="split-request-list">
          {rowState.map(({ row, micro }, index) => {
            const message = formatSplitRequest({
              participantName: row.name,
              usdcMicro: micro,
              receiptRef: receiptUrl,
            });
            const isCopied = copiedIndex === index;
            return (
              <li
                key={row.id}
                data-testid="split-request-message"
                className="space-y-1.5 rounded-lg border border-black/10 p-2.5"
              >
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-black">
                  {message}
                </pre>
                <button
                  type="button"
                  onClick={() => handleCopy(message, index)}
                  aria-label={`Copy request ${index + 1}`}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-black/15 px-2.5 text-[11px] font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                >
                  {isCopied ? (
                    <CopySuccess size="12" variant="Bold" aria-hidden="true" />
                  ) : (
                    <Copy size="12" variant="Linear" aria-hidden="true" />
                  )}
                  {isCopied ? "Copied" : "Copy request"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

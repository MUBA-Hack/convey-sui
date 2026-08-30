"use client";

import { useId, useState } from "react";
import type { QuoteEnvelope } from "@/lib/remittance/quote";
import {
  CITY_OPTIONS,
  buildCommand,
  isValidRecipient,
  parseAmountToMinor,
  resolveCityAlias,
} from "@/lib/remittance/quote-form";
import { formatMyr } from "@/lib/remittance/money";

/**
 * Structured transfer editor — amount, recipient, destination prefilled from
 * the quote. "Update quote" submits a fresh command through the existing
 * quote endpoint; the quote is never mutated locally. Validation mirrors the
 * parser/quote-builder bounds so an invalid amount is blocked before fetch.
 */
export interface RemittanceEditTransferFormProps {
  quote: QuoteEnvelope;
  onCancel: () => void;
  onSubmit: (command: string) => void;
}

export function RemittanceEditTransferForm({
  quote,
  onCancel,
  onSubmit,
}: RemittanceEditTransferFormProps) {
  const initialAmount = formatMyr(quote.youPayMinor);
  const initialCityAlias = resolveCityAlias(quote.destinationCity);

  const [amount, setAmount] = useState(initialAmount);
  const [recipient, setRecipient] = useState(quote.recipient);
  const [cityAlias, setCityAlias] = useState(initialCityAlias);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const amountId = useId();
  const recipientId = useId();
  const cityId = useId();

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    let bad = false;
    const amountResult = parseAmountToMinor(amount);
    if (!amountResult.ok) {
      setAmountError(amountResult.reason);
      bad = true;
    } else {
      setAmountError(null);
    }
    const recipientTrimmed = recipient.trim();
    if (!isValidRecipient(recipientTrimmed)) {
      setRecipientError("Enter a 1–40 character name.");
      bad = true;
    } else {
      setRecipientError(null);
    }
    if (bad) return;
    onSubmit(buildCommand(amount, recipientTrimmed, cityAlias));
  };

  return (
    <form
      data-testid="edit-transfer-form"
      onSubmit={handleUpdate}
      className="space-y-3 border-t border-black/8 p-4"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
        Edit details
      </p>

      <div className="space-y-1">
        <label
          htmlFor={amountId}
          className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500"
        >
          Amount (MYR)
        </label>
        <input
          id={amountId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          data-testid="edit-amount-field"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            if (amountError) setAmountError(null);
          }}
          className="h-11 w-full rounded-lg border border-black/12 bg-white px-3 font-mono text-sm tabular-nums text-black outline-none focus:border-black/40"
          aria-invalid={amountError ? true : undefined}
        />
        {amountError && (
          <p role="alert" className="text-[11px] text-destructive">
            {amountError}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label
          htmlFor={recipientId}
          className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500"
        >
          Recipient
        </label>
        <input
          id={recipientId}
          type="text"
          autoComplete="off"
          data-testid="edit-recipient-field"
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value);
            if (recipientError) setRecipientError(null);
          }}
          className="h-11 w-full rounded-lg border border-black/12 bg-white px-3 text-sm text-black outline-none focus:border-black/40"
          aria-invalid={recipientError ? true : undefined}
        />
        {recipientError && (
          <p role="alert" className="text-[11px] text-destructive">
            {recipientError}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label
          htmlFor={cityId}
          className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500"
        >
          Destination
        </label>
        <select
          id={cityId}
          data-testid="edit-destination-field"
          value={cityAlias}
          onChange={(e) => setCityAlias(e.target.value)}
          className="h-11 w-full rounded-lg border border-black/12 bg-white px-3 text-sm text-black outline-none focus:border-black/40"
        >
          {CITY_OPTIONS.map((c) => (
            <option key={c.alias} value={c.alias}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          data-hit-target="true"
          className="cv-btn-ghost inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          data-testid="update-quote"
          data-hit-target="true"
          className="cv-btn-solid inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
        >
          Update quote
        </button>
      </div>
    </form>
  );
}

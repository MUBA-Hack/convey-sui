"use client";

import { useEffect, useState } from "react";
import type { QuoteEnvelope } from "@/lib/remittance/quote";
import { isExpired } from "@/lib/remittance/quote-schema";
import { Edit2, Refresh } from "@/components/icons";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { buildQuoteViewModel, buildRefreshCommand } from "@/lib/remittance/quote-form";
import { SheetDisclosure } from "./sheet-disclosure";
import { RemittanceEditTransferForm } from "./remittance-edit-transfer-form";

/**
 * Quote settlement ticket — one review surface, never a chat transcript.
 *
 * Above the fold: recipient identity, a black amount/receive tile, fee,
 * converted, rate, expiry, bank payout status, one truth line, and one
 * primary action. Technical fields (rail, recipient address, reference, the
 * wallet USDC transfer) live in the Transfer details disclosure.
 *
 * CTA gating is driven by an explicit `blocker` so each missing prerequisite
 * gets its own honest copy, demoted to a compact inline status near the
 * action — never a large focal alert:
 *  - `none` → "Review testnet transfer" opens the checkout modal.
 *  - `unmapped` → "{name} isn't available for wallet settlement yet." +
 *    "Choose recipient" (opens the structured editor).
 *  - `unapproved` → "This quote cannot be approved for wallet settlement." +
 *    Refresh + Edit details.
 *  - `wallet` → "Connect wallet to continue" is the honest primary.
 *  - `wrong-network` → "Switch your wallet to Sui testnet to continue."
 * An expired quote offers "Refresh quote" and never reaches the wallet.
 *
 * Status lifecycle locks the ticket once a transfer is in flight
 * (`submitted` / `unknown` / `confirmed`): no Reopen, Review, or Edit.
 */
export type QuotePreviewStatus =
  | "pending"
  | "cancelled"
  | "submitted"
  | "unknown"
  | "confirmed";

/**
 * The exact missing prerequisite that blocks a real testnet transfer, resolved
 * by the parent (which owns wallet/network state). Order matters: an unmapped
 * recipient is checked before attestation, which is checked before wallet
 * absence, which is checked before the wrong-network case. `none` = executable.
 */
export type QuoteBlocker =
  | "none"
  | "unmapped"
  | "unapproved"
  | "wallet"
  | "wrong-network";

export interface RemittanceQuotePreviewProps {
  quote: QuoteEnvelope;
  status: QuotePreviewStatus;
  blocker: QuoteBlocker;
  onConfirm: () => void;
  onCancel: () => void;
  onReopen: () => void;
  onSubmitQuote: (command: string) => void;
}

// Locked lifecycle states render one shared block; data drives the copy.
const LOCKED_STATES: {
  status: "submitted" | "unknown";
  testId: string;
  title: string;
  body: string;
}[] = [
  {
    status: "submitted",
    testId: "remittance-preview-submitted",
    title: "Submitted — confirmation pending",
    body: "The transfer was submitted. Check your wallet or the explorer before taking any action. Do not retry.",
  },
  {
    status: "unknown",
    testId: "remittance-preview-unknown",
    title: "Transfer outcome unknown",
    body: "Transfer outcome unknown — check your wallet before taking any action.",
  },
];

export function RemittanceQuotePreview({
  quote,
  status,
  blocker,
  onConfirm,
  onCancel,
  onReopen,
  onSubmitQuote,
}: RemittanceQuotePreviewProps) {
  const vm = buildQuoteViewModel(quote);

  const [editMode, setEditMode] = useState(false);
  const [demoPreview, setDemoPreview] = useState(false);
  // Reactive clock so an expiring quote flips to Refresh without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const locked = status === "submitted" || status === "unknown" || status === "confirmed";
  const expired = isExpired(quote.expiresAt, now);
  const secondsRemaining = Math.max(0, Math.ceil((quote.expiresAt - now) / 1000));
  const expiryLabel = `${Math.floor(secondsRemaining / 60)}m ${String(secondsRemaining % 60).padStart(2, "0")}s`;
  const humanRate = quote.exchangeRate.rateText.replace(/(\d+\.\d{4})\d+/, "$1");

  return (
    <div
      data-testid="remittance-quote-preview"
      className="cv-money-sheet cv-preview-in mt-3 overflow-hidden rounded-2xl"
    >
      {/* Recipient contact chip — rich identity at the top of the ticket. */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <span aria-hidden className="cv-contact-portrait shrink-0">
          <span className="cv-contact-portrait__head" />
          <span className="cv-contact-portrait__body" />
        </span>
        <div className="min-w-0">
          <p
            data-testid="quote-recipient"
            className="truncate text-base font-semibold tracking-[-0.01em] text-black"
          >
            {quote.recipient}
          </p>
          <p
            data-testid="quote-destination"
            className="mt-0.5 truncate text-[12px] text-neutral-500"
          >
            {vm.city}, {quote.destinationCountry}
          </p>
        </div>
      </div>

      {/* Black amount/receive tile — strong visual depth, financial sans
          numerals (no mono/slashed zeros). Fixed two-decimal typesetting. */}
      <div className="cv-money-tile mx-4 grid gap-4 rounded-[18px] bg-black p-4 text-white sm:grid-cols-2 sm:gap-0">
        <div className="sm:border-r sm:border-white/12 sm:pr-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
            You send
          </p>
          <div
            data-testid="quote-you-pay"
            className="mt-1 font-sans text-[32px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white"
          >
            RM{vm.sendAmount}
          </div>
        </div>
        <div className="border-t border-white/12 pt-3 sm:border-t-0 sm:pt-0 sm:pl-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/55">
            {quote.recipient} could receive
          </p>
          <div
            data-testid="quote-family-receives"
            className="mt-1 font-sans text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white"
          >
            PHP {vm.phpPayout}
          </div>
        </div>
      </div>

      {/* Visible summary — fee, converted, rate, live expiry, payout method.
          No disclosure required to see any decision-critical row. Money in
          financial sans; the rate is a technical reference and stays mono. */}
      <dl className="space-y-1.5 px-4 pt-3 pb-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-neutral-500">Fee deducted</dt>
          <dd
            data-testid="quote-fee"
            className="font-sans font-medium tabular-nums text-neutral-700"
          >
            RM{vm.fee}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-neutral-500">Amount converted</dt>
          <dd
            data-testid="quote-converted"
            className="font-sans font-medium tabular-nums text-neutral-700"
          >
            RM{vm.converted}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-neutral-500">Rate</dt>
          <dd
            data-testid="quote-rate"
            className="font-sans tabular-nums text-neutral-700"
          >
            {humanRate}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-neutral-500">Rate locked for</dt>
          <dd
            data-testid="quote-expiry"
            className="font-sans font-medium tabular-nums text-neutral-700"
          >
            {expiryLabel}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-neutral-500">Payout method</dt>
          <dd data-testid="quote-payout-method" className="text-right text-neutral-700">
            {blocker === "unmapped" ? "Bank payout" : quote.payoutMethod}
          </dd>
        </div>
      </dl>

      <p className="px-4 pb-3 text-[11px] leading-relaxed text-neutral-500">
        Reference FX · no MYR charge until you approve.
      </p>

      {status === "pending" && !editMode && !demoPreview && (
        <PendingAction
          expired={expired}
          blocker={blocker}
          recipientName={quote.recipient}
          onConfirm={onConfirm}
          onEdit={() => setEditMode(true)}
          onDismiss={onCancel}
          onRefresh={() => onSubmitQuote(buildRefreshCommand(quote))}
          onDemo={() => setDemoPreview(true)}
        />
      )}

      {status === "pending" && demoPreview && (
        <div data-testid="demo-payout-receipt" className="border-t border-black/8 p-4">
          <div className="rounded-xl bg-black p-4 text-white">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">Demo receipt</p>
                <p className="mt-1 text-lg font-semibold">Bank handoff previewed</p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg font-bold text-black">✓</span>
            </div>
            <p className="mt-4 border-t border-white/15 pt-3 text-xs leading-relaxed text-white/65">
              Simulation only. No funds moved and no bank or on-chain settlement occurred.
            </p>
          </div>
          <button type="button" className="mt-2 min-h-11 w-full text-xs font-semibold text-neutral-600" onClick={() => setDemoPreview(false)}>
            Back to quote
          </button>
        </div>
      )}

      {status === "pending" && editMode && (
        <RemittanceEditTransferForm
          quote={quote}
          onCancel={() => setEditMode(false)}
          onSubmit={(command) => {
            setEditMode(false);
            onSubmitQuote(command);
          }}
        />
      )}

      {status === "cancelled" && (
        <div className="flex items-center justify-between gap-3 border-t border-black/8 p-4">
          <p className="text-sm text-neutral-500">Quote dismissed.</p>
          <button
            type="button"
            data-hit-target="true"
            className="cv-btn-ghost inline-flex h-11 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            onClick={onReopen}
          >
            Reopen
          </button>
        </div>
      )}

      {LOCKED_STATES.filter((s) => s.status === status).map((s) => (
        <div
          key={s.status}
          data-testid={s.testId}
          className="border-t border-black/8 p-4 text-sm"
        >
          <p className="font-medium text-black">{s.title}</p>
          <p className="mt-1 text-neutral-600">{s.body}</p>
        </div>
      ))}

      {locked && (
        <p className="border-t border-black/8 px-4 py-2.5 text-[11px] text-neutral-400" aria-hidden>
          This quote is locked while the transfer is in flight.
        </p>
      )}

      {/* Transfer details — collapsed technical disclosure below the action:
          rail, recipient address, reference, and the wallet USDC transfer. */}
      <SheetDisclosure label="Transfer details" triggerTestId="transfer-details-trigger">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <dt className="text-neutral-500">Settlement rail</dt>
          <dd data-testid="quote-rail" className="text-neutral-700">
            {quote.settlementRail}
          </dd>
          <dt className="text-neutral-500">Wallet transfer</dt>
          <dd
            data-testid="quote-usdc"
            className="font-mono tabular-nums text-neutral-700"
          >
            {vm.usdcAmount} testnet USDC
          </dd>
          <dt className="text-neutral-500">Recipient address</dt>
          <dd className="font-mono text-neutral-700" title={quote.recipientAddress ?? ""}>
            {quote.recipientAddress
              ? `${quote.recipientAddress.slice(0, 6)}…${quote.recipientAddress.slice(-4)}`
              : "—"}
          </dd>
          <dt className="text-neutral-500">Reference</dt>
          <dd data-testid="quote-reference" className="font-mono">
            {quote.beneficiaryRef}
          </dd>
        </dl>
      </SheetDisclosure>
    </div>
  );
}

interface PendingActionProps {
  expired: boolean;
  blocker: QuoteBlocker;
  recipientName: string;
  onConfirm: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onRefresh: () => void;
  onDemo: () => void;
}

/** Compact inline blocker copy — one honest line per missing prerequisite. */
function blockerCopy(
  blocker: QuoteBlocker,
  recipientName: string,
): { title: string; body: string } {
  if (blocker === "wallet") return { title: "Connect wallet to continue", body: "" };
  if (blocker === "wrong-network")
    return { title: "Switch wallet network", body: "Switch your wallet to Sui testnet to continue." };
  if (blocker === "unmapped")
    return { title: "Recipient setup needed", body: `${recipientName} has no wallet mapping yet.` };
  return { title: "Preview only", body: "This quote cannot be approved for wallet settlement." };
}

/** The above-fold primary action, branched on the exact missing prerequisite. */
function PendingAction({
  expired,
  blocker,
  recipientName,
  onConfirm,
  onEdit,
  onDismiss,
  onRefresh,
  onDemo,
}: PendingActionProps) {
  if (expired) {
    return (
      <div className="border-t border-black/8 p-4">
        <div
          data-testid="remittance-expired"
          className="rounded-lg border border-black/10 bg-neutral-50 p-3"
        >
          <p className="text-sm font-medium text-black">Quote expired</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            Get a fresh quote for the same details to continue.
          </p>
          <button
            type="button"
            data-testid="refresh-quote"
            data-hit-target="true"
            className="cv-btn-solid mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            onClick={onRefresh}
          >
            <Refresh size={15} variant="Linear" />
            Refresh quote
          </button>
        </div>
      </div>
    );
  }

  if (blocker === "none") {
    return (
      <div className="border-t border-black/8 p-4">
        <button
          type="button"
          data-hit-target="true"
          className="cv-btn-solid inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={onConfirm}
        >
          Review testnet transfer
        </button>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            data-testid="edit-transfer"
            data-hit-target="true"
            className="cv-btn-ghost inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            onClick={onEdit}
          >
            <Edit2 size={15} variant="Linear" />
            Edit details
          </button>
          <button
            type="button"
            data-hit-target="true"
            className="cv-btn-ghost inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // Blocked: each missing prerequisite gets one compact inline status line
  // near the action. Connect wallet is the primary ONLY when a connected
  // testnet wallet is the sole missing prerequisite; every other branch
  // offers a constructive editor/refresh action and never a misleading Sign in.
  const copy = blockerCopy(blocker, recipientName);
  const editorLabel = blocker === "unmapped" ? "Change recipient" : "Edit details";

  if (blocker === "unmapped") {
    return (
      <div className="border-t border-black/8 p-4">
        <button
          type="button"
          data-testid="preview-demo-payout"
          data-hit-target="true"
          className="cv-btn-solid inline-flex h-12 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={onDemo}
        >
          Preview payout to {recipientName}
        </button>
        <button
          type="button"
          data-testid="edit-transfer"
          data-hit-target="true"
          className="mt-2 inline-flex h-10 w-full items-center justify-center gap-1.5 text-xs font-semibold text-neutral-600"
          onClick={onEdit}
        >
          <Edit2 size={15} variant="Linear" />
          {editorLabel}
        </button>
      </div>
    );
  }
  return (
    <div className="border-t border-black/8 p-4">
      <div
        data-testid="remittance-preview-only"
        className="rounded-lg border border-black/8 bg-neutral-50/60 p-2.5"
      >
        <p className="text-xs font-medium text-black">{copy.title}</p>
        {copy.body && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-600">{copy.body}</p>
        )}
        {blocker === "wallet" && (
          <div className="mt-2">
            <WalletConnectButton />
          </div>
        )}
      </div>


      {blocker === "unapproved" && (
        <button
          type="button"
          data-testid="refresh-quote"
          data-hit-target="true"
          className="cv-btn-solid mt-2 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={onRefresh}
        >
          <Refresh size={15} variant="Linear" />
          Refresh quote
        </button>
      )}
      <button
        type="button"
        data-testid="edit-transfer"
        data-hit-target="true"
        className="cv-btn-ghost mt-2 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
        onClick={onEdit}
      >
        <Edit2 size={15} variant="Linear" />
        {editorLabel}
      </button>
      <button
        type="button"
        data-hit-target="true"
        className="mt-2 inline-flex h-9 w-full items-center justify-center text-[11px] font-medium text-neutral-500 underline-offset-4 hover:text-neutral-800 hover:underline"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

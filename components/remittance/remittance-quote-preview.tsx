"use client";

import { useEffect, useState } from "react";
import { formatMyr, type QuoteEnvelope } from "@/lib/remittance/quote";
import { isExpired } from "@/lib/remittance/quote-schema";
import { hasValidAttestation } from "@/lib/remittance/transfer";
import { buildQuoteViewModel, buildRefreshCommand } from "@/lib/remittance/quote-form";
import { SheetDisclosure } from "./sheet-disclosure";
import { RemittanceEditTransferForm } from "./remittance-edit-transfer-form";
import { FamilyGuardianCard } from "./family-guardian-card";
import {
  RemittanceQuoteActions,
  type QuoteBlocker,
} from "./remittance-quote-actions";
import { RemittanceQuoteCarry } from "./remittance-quote-carry";
import { RemittanceMoneySlab } from "./remittance-money-slab";

function isHandoffEligible(quote: QuoteEnvelope, now: number): boolean {
  if (isExpired(quote.expiresAt, now)) return false;
  if (!quote.recipientAddress) return false;
  return hasValidAttestation(quote.attestation);
}

function formatExpiryLabel(secondsRemaining: number): string {
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = String(secondsRemaining % 60).padStart(2, "0");
  return `${minutes}m ${seconds}s`;
}

/**
 * Quote settlement ticket — one review surface, never a chat transcript.
 *
 * Above the fold: recipient identity, a black amount/receive tile, fee,
 * rate, expiry, one truth line, and one
 * primary action. Technical fields (rail, recipient address, reference, the
 * wallet USDC transfer) live in the Transfer details disclosure.
 *
 * CTA gating is driven by an explicit `blocker` so each missing prerequisite
 * gets its own honest copy, demoted to a compact inline status near the
 * action — never a large focal alert:
 *  - `none` → "Review transfer" opens the checkout modal.
 *  - `unmapped` → "{name} isn't available for wallet settlement yet." +
 *    "Set up recipient" (opens the structured editor).
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
export type { QuoteBlocker } from "./remittance-quote-actions";

export interface RemittanceQuotePreviewProps {
  quote: QuoteEnvelope;
  status: QuotePreviewStatus;
  blocker: QuoteBlocker;
  onConfirm: () => void;
  onCancel: () => void;
  onReopen: () => void;
  /**
   * Submits an edited or refreshed quote command to the server. When omitted
   * (e.g. for a carried quote that was imported across an air gap and cannot
   * be rebuilt locally), edit/refresh affordances are hidden — the customer
   * uses the parent's "Scan another" action to get a fresh quote instead.
   */
  onSubmitQuote?: (command: string) => void;
  confirmLabel?: string;
  /**
   * When true, the parent has mounted the authoritative settlement card
   * (digest + explorer + payout status) with its own consolidated
   * "Transfer details" disclosure. The preview then omits its own
   * "Transfer details" disclosure so the resolved view shows one detail
   * surface, not an orphan/duplicate strip at the page bottom.
   */
  settled?: boolean;
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
  confirmLabel,
  settled = false,
}: RemittanceQuotePreviewProps) {
  const vm = buildQuoteViewModel(quote);
  const editable = Boolean(onSubmitQuote);

  const [editMode, setEditMode] = useState(false);
  const [carryOpen, setCarryOpen] = useState(false);
  // Reactive clock so an expiring quote flips to Refresh without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const locked = status === "submitted" || status === "unknown" || status === "confirmed";
  const expired = isExpired(quote.expiresAt, now);
  const secondsRemaining = Math.max(0, Math.ceil((quote.expiresAt - now) / 1000));
  const expiryLabel = formatExpiryLabel(secondsRemaining);
  const humanRate = quote.exchangeRate.rateText.replace(/(\d+\.\d{4})\d+/, "$1");
  const handoffEligible = isHandoffEligible(quote, now);

  if (status === "pending" && carryOpen && handoffEligible) {
    return (
      <RemittanceQuoteCarry
        quote={quote}
        city={vm.city}
        sendAmount={`RM${vm.sendAmount}`}
        expired={expired}
        expiryLabel={expiryLabel}
        onClose={() => setCarryOpen(false)}
      />
    );
  }

  return (
    <div
      data-testid="remittance-quote-preview"
      className="cv-money-sheet cv-preview-in mt-3 overflow-hidden rounded-2xl"
    >
      {/* Two desktop groups inside one sheet. Below lg the groups stack so the
         mobile order stays recipient → amount → summary → rule → checks →
         truth → action → details; at lg the left group carries recipient +
         black amounts + fee/rate/payout summary + family rule, and the right
         group carries the Guardian + truth line + primary action + transfer
         details. */}
      <div
        data-testid="quote-workspace-grid"
        className="lg:grid lg:grid-cols-[minmax(0,56fr)_minmax(0,44fr)] lg:items-start lg:gap-0"
      >
        <div data-testid="quote-left-group" className="lg:flex lg:flex-col lg:self-stretch lg:border-r lg:border-black/8">
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

          <RemittanceMoneySlab
            receiveLabel={`${quote.recipient} · estimated receive`}
            sendAmount={`RM${vm.sendAmount}`}
            receiveAmount={`PHP ${vm.phpPayout}`}
            testId="quote-money-slab"
            sendTestId="quote-you-pay"
            receiveTestId="quote-family-receives"
            className="mx-4 lg:mx-5"
          />

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
          </dl>

          <FamilyRulePanel quote={quote} />

          {/* Corridor footer — anchors the left group's lower band so the
              rate summary is not followed by a dead gray mid-band on desktop.
              Existing product/corridor information only; no new claim. On
              desktop the left group stretches to the card height and this
              line is pushed to the bottom; on mobile it sits right under the
              rate summary / rule panel. */}
          <p
            data-testid="quote-corridor"
            className="mt-auto px-4 pb-4 pt-2 text-[11px] text-neutral-500"
          >
            {quote.corridor.source} → {quote.corridor.destination}
          </p>
        </div>

        <div data-testid="quote-right-group" className="lg:flex lg:flex-col lg:pt-4">
          {/* Pre-verification guardian — pre-submission review aid only. Never
              renders once the ticket is locked (submitted / unknown /
              confirmed / cancelled), so a locked card can never read "Ready
              to review." */}
          {status === "pending" && (
            <FamilyGuardianCard quote={quote} blocker={blocker} now={now} />
          )}

          <p
            data-testid="quote-truth"
            className="px-4 pb-3 text-[11px] leading-relaxed text-neutral-500"
          >
            Reference FX · no MYR charge until you approve.
          </p>

          {status === "pending" && !editMode && (
            <RemittanceQuoteActions
              quote={quote}
              expired={expired}
              blocker={blocker}
              confirmLabel={confirmLabel}
              onConfirm={onConfirm}
              onEdit={() => setEditMode(true)}
              onDismiss={onCancel}
              onRefresh={() => onSubmitQuote?.(buildRefreshCommand(quote))}
              handoffEligible={handoffEligible}
              onCarry={() => setCarryOpen(true)}
              editable={editable}
            />
          )}

          {status === "pending" && editMode && editable && (
            <RemittanceEditTransferForm
              quote={quote}
              onCancel={() => setEditMode(false)}
              onSubmit={(command) => {
                setEditMode(false);
                onSubmitQuote?.(command);
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

          {/* Transfer details — collapsed technical disclosure below the
              action: rail, recipient address, reference, and the wallet USDC
              transfer. Hidden once the parent mounts the authoritative
              settlement card with its own consolidated disclosure, so the
              resolved view shows one detail surface (no orphan/duplicate
              strip at the page bottom). */}
          {!settled && (
          <SheetDisclosure label="Transfer details" triggerTestId="transfer-details-trigger">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-neutral-500">Amount converted</dt>
              <dd
                data-testid="quote-converted"
                className="font-sans tabular-nums text-neutral-700"
              >
                RM{vm.converted}
              </dd>
              <dt className="text-neutral-500">Payout method</dt>
              <dd data-testid="quote-payout-method" className="text-neutral-700">
                {quote.payoutMethod}
              </dd>
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
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Family Rule panel — a substantial first-class decision object inside the
 * quote, not a hairline row. Visual mass is comparable to the primary
 * send/receive amount block, but it sits below it and stays visually distinct.
 *
 * Rendered ONLY when the request carries a real rule (a purpose or a
 * per-transfer maximum). Ordinary transfers with neither render nothing — no
 * panel, no "Checked locally" reviewer label, no chrome — so a no-rule
 * transfer never implies a rule exists.
 *
 * Hierarchy, black on white: the purpose is the semantic headline (the reason
 * this transfer exists), the cap is the prominent financial metric on a black
 * band, and the reviewer status/provenance is a subordinate line. No tabs, no
 * debug labels, no decorative icons, no color. The wording never claims a
 * stored account-wide family policy — the rule is the per-transfer cap stated
 * in this request and verified at settlement.
 */
function FamilyRulePanel({ quote }: { quote: QuoteEnvelope }) {
  const review = quote.intentReview;
  const hasRule =
    review.maximumFamilyLimitMinor !== null || review.purpose !== null;
  if (!hasRule) return null;

  const limitLabel =
    review.maximumFamilyLimitMinor !== null
      ? `Within RM${formatMyr(review.maximumFamilyLimitMinor)}`
      : null;
  const purposeLabel = review.purpose
    ? review.purpose.charAt(0).toUpperCase() + review.purpose.slice(1)
    : null;
  const reviewerLabel =
    review.reviewer === "gonka" ? "Reviewed by Gonka" : "Checked locally";

  return (
    <div
      data-testid="family-rule-panel"
      className="mx-4 mb-3 overflow-hidden rounded-xl border border-black/12"
    >
      {/* Purpose — the semantic headline of the rule. */}
      {purposeLabel && (
        <div className="bg-white px-4 pt-3.5 pb-3">
          <p
            data-testid="family-rule-purpose"
            className="text-[19px] font-semibold leading-tight tracking-[-0.01em] text-black"
          >
            {purposeLabel}
          </p>
        </div>
      )}
      {/* Cap — the prominent financial metric on a black band. */}
      {limitLabel && (
        <div className="flex items-baseline justify-between gap-3 bg-black px-4 py-3 text-white">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
            Maximum
          </span>
          <span
            data-testid="family-rule-limit"
            className="font-sans text-[22px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white"
          >
            {limitLabel}
          </span>
        </div>
      )}
      {/* Reviewer status/provenance — subordinate. */}
      <div className="bg-white px-4 py-2">
        <p
          data-testid="family-rule-reviewer"
          className="text-[11px] leading-snug text-neutral-500"
        >
          {reviewerLabel}
        </p>
      </div>
    </div>
  );
}

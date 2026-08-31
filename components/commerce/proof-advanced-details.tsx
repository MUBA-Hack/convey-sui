"use client";

import { type RefObject } from "react";
import { DocumentText } from "@/components/icons";
import { SheetDisclosure } from "@/components/remittance/sheet-disclosure";
import {
  type ReceiptProofResult,
  type VerifiedReceiptProof,
} from "@/lib/commerce/receipt-proof";
import {
  type RemittanceReceiptResult,
  type VerifiedRemittanceReceipt,
} from "@/lib/remittance/receipt-proof";
import {
  type ProtectedTransferCreatedReceiptResult,
  type VerifiedProtectedTransferCreatedReceipt,
} from "@/lib/remittance/protected-transfer-created-receipt";
import type { ProtectedTransferTerminalLifecycleResult } from "@/lib/remittance/protected-transfer-terminal-lifecycle";
import {
  type ProtectedTransferTerminalReceiptResult,
  type VerifiedProtectedTransferTerminalReceipt,
} from "@/lib/remittance/protected-transfer-terminal-receipt";
import { formatMyrGrouped } from "@/lib/remittance/money";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import type { SettlementCheckState } from "./remittance-settlement-status";

export type CreatedCheckState =
  | { status: "checking" }
  | { status: "verified" }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "rejected" }
  | { status: "error" };

export const CHECKING_CREATED: CreatedCheckState = { status: "checking" };

export type TerminalLifecycleState =
  | { kind: "checking" }
  | ProtectedTransferTerminalLifecycleResult;

export const CHECKING_TERMINAL: TerminalLifecycleState = { kind: "checking" };

// Shared state model — defined here so the orchestrator (proof-verifier.tsx)
// can import it without a circular dependency. One authoritative state model:
// `empty` until a receipt is decoded, then a typed result view.
export type QuoteVerifyStatus =
  | "checking"
  | "verified"
  | "evidence"
  | "rejected"
  | "error";

export type EvidenceView =
  | { kind: "empty" }
  | { kind: "commerce"; result: ReceiptProofResult }
  | {
      kind: "remittance";
      result: RemittanceReceiptResult;
      quoteVerify: QuoteVerifyStatus;
      settlementVerify: SettlementCheckState;
    }
  | {
      kind: "protected-transfer-created";
      result: ProtectedTransferCreatedReceiptResult;
      createdVerify: CreatedCheckState;
    }
  | {
      kind: "protected-transfer-terminal";
      result: ProtectedTransferTerminalReceiptResult;
      lifecycle: TerminalLifecycleState;
      payload: string | null;
    }
  | {
      kind: "remittance-unsettled";
      recipient: string | null;
      destinationCity: string | null;
    };

export const EMPTY_VIEW: EvidenceView = { kind: "empty" };

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Technical family-rule binding label — gated on server verification. */
export function ruleLabel(quote: QuoteEnvelope, quoteVerify: QuoteVerifyStatus): string {
  const { purpose, maximumFamilyLimitMinor } = quote.intentReview;
  const isServerVerified = quoteVerify === "verified" || quoteVerify === "evidence";
  const binding = isServerVerified
    ? "Server seal verified"
    : "Includes server seal (verification separate)";
  if (purpose && maximumFamilyLimitMinor) {
    return `Family rule · ${titleCase(purpose)} · Within RM${formatMyrGrouped(maximumFamilyLimitMinor)} maximum · ${binding}`;
  }
  if (purpose) return `Family rule · ${titleCase(purpose)} · ${binding}`;
  if (maximumFamilyLimitMinor) return `Family rule · Within RM${formatMyrGrouped(maximumFamilyLimitMinor)} maximum · ${binding}`;
  return "No family rule stated";
}

export interface ProofAdvancedDetailsProps {
  raw: string;
  onRawChange: (value: string) => void;
  onVerify: () => void;
  onLoadSample: () => void;
  onImportFile: (file: File | undefined) => void;
  fileRef: RefObject<HTMLInputElement | null>;
  view: EvidenceView;
}

export function ProofAdvancedDetails({
  raw,
  onRawChange,
  onVerify,
  onLoadSample,
  onImportFile,
  fileRef,
  view,
}: ProofAdvancedDetailsProps) {
  return (
    <SheetDisclosure
      label="Advanced details"
      triggerTestId="proof-advanced-trigger"
      className="mt-6 rounded-2xl border border-black/10 bg-white"
    >
      <div className="space-y-6 pt-4">
        <InputSection
          raw={raw}
          onRawChange={onRawChange}
          onVerify={onVerify}
          onLoadSample={onLoadSample}
          onImportFile={onImportFile}
          fileRef={fileRef}
        />
        {view.kind === "commerce" && view.result.ok ? (
          <CommerceTechnical result={view.result} />
        ) : null}
        {view.kind === "remittance" && view.result.ok ? (
          <RemittanceTechnical
            result={view.result}
            quoteVerify={view.quoteVerify}
            settlementVerify={view.settlementVerify}
          />
        ) : null}
        {view.kind === "protected-transfer-created" && view.result.ok ? (
          <ProtectedTransferCreatedTechnical
            result={view.result}
            createdVerify={view.createdVerify}
          />
        ) : null}
        {view.kind === "protected-transfer-terminal" && view.result.ok ? (
          <ProtectedTransferTerminalTechnical
            result={view.result}
            lifecycle={view.lifecycle}
          />
        ) : null}
      </div>
    </SheetDisclosure>
  );
}

// ---------------------------------------------------------------------------
// Input section — paste / import / sample / verify. Subordinate to the
// receipt; a customer opening a share link never needs to open it.
// ---------------------------------------------------------------------------

function InputSection({
  raw,
  onRawChange,
  onVerify,
  onLoadSample,
  onImportFile,
  fileRef,
}: Omit<ProofAdvancedDetailsProps, "view">) {
  return (
    <div>
      <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
        Receipt input
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-neutral-600">
          Paste, import, or load a sample to inspect a receipt.
        </p>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-black/15 bg-white px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-black">
          <DocumentText size="15" variant="Linear" aria-hidden="true" />
          Import JSON
          <input
            ref={fileRef}
            aria-label="Import JSON"
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => onImportFile(event.target.files?.[0])}
          />
        </label>
      </div>

      <label htmlFor="receipt-json" className="sr-only">
        Receipt JSON
      </label>
      <textarea
        id="receipt-json"
        value={raw}
        onChange={(event) => onRawChange(event.target.value)}
        spellCheck={false}
        placeholder={'{\n  "digest": "…",\n  "amountMist": "…"\n}'}
        className="mt-3 min-h-48 w-full resize-y rounded-xl border border-black/15 bg-neutral-50 p-4 font-mono text-xs leading-6 text-black outline-none transition placeholder:text-neutral-400 focus:border-black sm:min-h-64"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onVerify}
          disabled={!raw.trim()}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-black px-5 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Verify structure
        </button>
        <button
          type="button"
          onClick={onLoadSample}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-black/15 bg-white px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Load sample receipt
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commerce technical — canonical fields, structural checks, honest claim.
// ---------------------------------------------------------------------------

function CommerceTechnical({ result }: { result: VerifiedReceiptProof }) {
  const isDemo = result.kind === "demo_structure";
  return (
    <div data-testid="proof-technical" className="space-y-4">
      <SectionLabel>Canonical fields</SectionLabel>
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs">
        <dt className="text-neutral-500">Mode</dt>
        <dd className="font-mono text-black">{isDemo ? "demo / off-chain" : "real / testnet-formatted"}</dd>
        <dt className="text-neutral-500">Merchant address</dt>
        <dd className="break-all font-mono text-black">{result.receipt.merchantAddress}</dd>
        <dt className="text-neutral-500">Digest mark</dt>
        <dd className="break-all font-mono text-black">{result.receipt.digest}</dd>
        <dt className="text-neutral-500">Explorer URL</dt>
        <dd className="break-all font-mono text-black">{result.receipt.explorerUrl ?? "Absent (demo)"}</dd>
        <dt className="text-neutral-500">Exported at</dt>
        <dd className="font-mono text-black">{new Date(result.document.exportedAt).toISOString()}</dd>
      </dl>

      <SectionLabel>Structural checks</SectionLabel>
      <ol data-testid="proof-structural-checks" className="space-y-2">
        {result.evidence.map((item, index) => (
          <li key={item.label} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-black/10 px-3 py-2.5 text-xs">
            <span className="font-mono text-neutral-400">{index + 1}</span>
            <span className="font-semibold text-black">{item.label}</span>
            <span className="text-right text-neutral-500">{item.value}</span>
          </li>
        ))}
      </ol>

      <ClaimBox>{result.claim}</ClaimBox>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remittance technical — canonical fields, structural checks, honest claim,
// family-rule binding, network.
// ---------------------------------------------------------------------------

function RemittanceTechnical({
  result,
  quoteVerify,
  settlementVerify,
}: {
  result: VerifiedRemittanceReceipt;
  quoteVerify: QuoteVerifyStatus;
  settlementVerify: SettlementCheckState;
}) {
  const ok = result;
  const quote = ok.document.quote;
  const settlement = ok.document.settlement;
  return (
    <div data-testid="remittance-technical" className="space-y-4">
      <SectionLabel>Canonical fields</SectionLabel>
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs">
        <dt className="text-neutral-500">Network</dt>
        <dd className="font-mono text-black">{ok.document.network}</dd>
        <dt className="text-neutral-500">Recipient address</dt>
        <dd className="break-all font-mono text-black">{settlement.recipientAddress}</dd>
        <dt className="text-neutral-500">Beneficiary ref</dt>
        <dd className="font-mono text-black">{settlement.beneficiaryRef}</dd>
        <dt className="text-neutral-500">Payout status</dt>
        <dd className="font-mono text-black">{settlement.payoutStatus}</dd>
        <dt className="text-neutral-500">Quote expiry</dt>
        <dd className="font-mono text-black">{new Date(settlement.quoteExpiresAt).toISOString()}</dd>
        <dt className="text-neutral-500">Digest mark</dt>
        <dd className="break-all font-mono text-black">{settlement.digest}</dd>
        <dt className="text-neutral-500">Explorer URL</dt>
        <dd className="break-all font-mono text-black">{settlement.explorerUrl}</dd>
        <dt className="text-neutral-500">Confirmed at</dt>
        <dd className="font-mono text-black">{new Date(settlement.confirmedAt).toISOString()}</dd>
        <dt className="text-neutral-500">Exported at</dt>
        <dd className="font-mono text-black">{ok.document.exportedAt}</dd>
        <dt className="text-neutral-500">Family rule</dt>
        <dd className="text-black">{ruleLabel(quote, quoteVerify)}</dd>
      </dl>

      <SectionLabel>Structural checks</SectionLabel>
      <ol data-testid="remittance-structural-checks" className="space-y-2">
        {ok.evidence.map((item, index) => (
          <li key={item.label} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-black/10 px-3 py-2.5 text-xs">
            <span className="font-mono text-neutral-400">{index + 1}</span>
            <span className="font-semibold text-black">{item.label}</span>
            <span className="text-right text-neutral-500">{item.value}</span>
          </li>
        ))}
      </ol>

      <SectionLabel>Sui settlement check</SectionLabel>
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs">
        <dt className="text-neutral-500">Status</dt>
        <dd className="font-mono text-black">{settlementVerify.status}</dd>
        {settlementVerify.status === "verified" ? (
          <>
            <dt className="text-neutral-500">Network</dt>
            <dd className="font-mono text-black">{settlementVerify.evidence.network}</dd>
            <dt className="text-neutral-500">Digest</dt>
            <dd className="break-all font-mono text-black">{settlementVerify.evidence.digest}</dd>
            <dt className="text-neutral-500">Coin type</dt>
            <dd className="break-all font-mono text-black">{settlementVerify.evidence.coinType}</dd>
            <dt className="text-neutral-500">Recipient address</dt>
            <dd className="break-all font-mono text-black">{settlementVerify.evidence.recipientAddress}</dd>
            <dt className="text-neutral-500">Received micro units</dt>
            <dd className="font-mono text-black">{settlementVerify.evidence.receivedMicro}</dd>
            <dt className="text-neutral-500">Checked at</dt>
            <dd className="font-mono text-black">{settlementVerify.evidence.checkedAt}</dd>
          </>
        ) : settlementVerify.status === "rejected" || settlementVerify.status === "unavailable" ? (
          <>
            <dt className="text-neutral-500">Reason</dt>
            <dd className="font-mono text-black">{settlementVerify.reason}</dd>
          </>
        ) : null}
      </dl>

      <ClaimBox>
        {settlementVerify.status === "verified"
          ? "The independent Sui check matched this receipt. Bank or cash payout remains unconfirmed."
          : settlementVerify.status === "rejected"
            ? "The independent Sui check did not match this receipt. No settlement confirmation is claimed."
            : settlementVerify.status === "unavailable"
              ? "The independent Sui check is unavailable. Local receipt fields remain available without an on-chain confirmation claim."
              : "The independent Sui check is in progress. Local receipt fields do not confirm settlement on their own."}
      </ClaimBox>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
      {children}
    </p>
  );
}

function ClaimBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-black/10 bg-neutral-50 px-3 py-2.5 text-xs leading-5 text-neutral-600">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Protected Transfer Created technical — canonical escrow fields, the strict
// plan binding, the independent Created-event check, and an honest claim that
// never reaches beyond the Created event into release/refund/payout.
// ---------------------------------------------------------------------------

function createdCheckLabel(state: CreatedCheckState): string {
  switch (state.status) {
    case "verified":
      return "Created event matched on Sui testnet";
    case "not_found":
      return "Transaction not found on Sui testnet";
    case "unavailable":
      return "Independent check unavailable";
    case "rejected":
      return "Created event did not match";
    case "error":
      return "Independent check failed";
    case "checking":
    default:
      return "Re-checking Created event…";
  }
}

function ProtectedTransferCreatedTechnical({
  result,
  createdVerify,
}: {
  result: VerifiedProtectedTransferCreatedReceipt;
  createdVerify: CreatedCheckState;
}) {
  const doc = result.document;
  const transfer = doc.transfer;
  return (
    <div data-testid="protected-transfer-created-technical" className="space-y-4">
      <SectionLabel>Canonical fields</SectionLabel>
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs">
        <dt className="text-neutral-500">Network</dt>
        <dd className="font-mono text-black">{doc.created.network}</dd>
        <dt className="text-neutral-500">Escrow object</dt>
        <dd className="break-all font-mono text-black">{transfer.escrowObjectId}</dd>
        <dt className="text-neutral-500">Payer address</dt>
        <dd className="break-all font-mono text-black">{transfer.payerAddress}</dd>
        <dt className="text-neutral-500">Beneficiary address</dt>
        <dd className="break-all font-mono text-black">{transfer.beneficiaryAddress}</dd>
        <dt className="text-neutral-500">Reviewer</dt>
        <dd className="break-all font-mono text-black">
          {transfer.reviewerName} · {transfer.reviewerAddress}
        </dd>
        <dt className="text-neutral-500">Package</dt>
        <dd className="break-all font-mono text-black">{transfer.packageId}</dd>
        <dt className="text-neutral-500">Coin type</dt>
        <dd className="break-all font-mono text-black">{transfer.coinType}</dd>
        <dt className="text-neutral-500">USDC micro</dt>
        <dd className="font-mono text-black">{transfer.amountMicro}</dd>
        <dt className="text-neutral-500">Deadline</dt>
        <dd className="font-mono text-black">{new Date(transfer.deadlineMs).toISOString()}</dd>
        <dt className="text-neutral-500">Evidence commitment</dt>
        <dd className="break-all font-mono text-black">{transfer.evidenceCommitmentHex}</dd>
        <dt className="text-neutral-500">Review note</dt>
        <dd className="text-black">{transfer.reviewNote}</dd>
        <dt className="text-neutral-500">Digest mark</dt>
        <dd className="break-all font-mono text-black">{transfer.digest}</dd>
        <dt className="text-neutral-500">Explorer URL</dt>
        <dd className="break-all font-mono text-black">{transfer.explorerUrl}</dd>
        <dt className="text-neutral-500">Created checked at</dt>
        <dd className="font-mono text-black">{transfer.createdCheckedAt}</dd>
        <dt className="text-neutral-500">Exported at</dt>
        <dd className="font-mono text-black">{doc.exportedAt}</dd>
      </dl>

      <SectionLabel>Independent Created-event check</SectionLabel>
      <p className="text-xs text-black">{createdCheckLabel(createdVerify)}</p>

      <ClaimBox>{result.claim}</ClaimBox>
    </div>
  );
}

function terminalLifecycleLabel(state: TerminalLifecycleState): string {
  if (state.kind === "checking") return "Checking the current lifecycle on Sui testnet";
  if (state.kind === "verified") {
    return state.terminal.action === "release"
      ? "Released event matched on Sui testnet"
      : "Refunded event matched on Sui testnet";
  }
  if (state.kind === "pending") return "Escrow remains open after a live check";
  if (state.kind === "unavailable") return "Independent lifecycle check unavailable";
  return `Lifecycle evidence needs review (${state.reason.replaceAll("_", " ")})`;
}

function ProtectedTransferTerminalTechnical({
  result,
  lifecycle,
}: {
  result: VerifiedProtectedTransferTerminalReceipt;
  lifecycle: TerminalLifecycleState;
}) {
  const transfer = result.document.transfer;
  return (
    <div data-testid="protected-transfer-terminal-technical" className="space-y-4">
      <SectionLabel>Canonical fields</SectionLabel>
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs">
        <dt className="text-neutral-500">Recorded outcome</dt>
        <dd className="font-mono text-black">{transfer.action}</dd>
        <dt className="text-neutral-500">Network</dt>
        <dd className="font-mono text-black">testnet</dd>
        <dt className="text-neutral-500">Escrow object</dt>
        <dd className="break-all font-mono text-black">{transfer.escrowObjectId}</dd>
        <dt className="text-neutral-500">Payer address</dt>
        <dd className="break-all font-mono text-black">{transfer.payerAddress}</dd>
        <dt className="text-neutral-500">Beneficiary address</dt>
        <dd className="break-all font-mono text-black">{transfer.beneficiaryAddress}</dd>
        <dt className="text-neutral-500">Reviewer address</dt>
        <dd className="break-all font-mono text-black">{transfer.reviewerAddress}</dd>
        <dt className="text-neutral-500">Actor address</dt>
        <dd className="break-all font-mono text-black">{transfer.actorAddress}</dd>
        <dt className="text-neutral-500">Package</dt>
        <dd className="break-all font-mono text-black">{transfer.packageId}</dd>
        <dt className="text-neutral-500">Coin type</dt>
        <dd className="break-all font-mono text-black">{transfer.coinType}</dd>
        <dt className="text-neutral-500">USDC micro</dt>
        <dd className="font-mono text-black">{transfer.amountMicro}</dd>
        <dt className="text-neutral-500">Deadline</dt>
        <dd className="font-mono text-black">{new Date(transfer.deadlineMs).toISOString()}</dd>
        <dt className="text-neutral-500">Evidence commitment</dt>
        <dd className="break-all font-mono text-black">{transfer.evidenceCommitmentHex}</dd>
        <dt className="text-neutral-500">Terminal digest</dt>
        <dd className="break-all font-mono text-black">{transfer.digest}</dd>
        <dt className="text-neutral-500">Terminal checked at</dt>
        <dd className="font-mono text-black">{transfer.terminalCheckedAt}</dd>
        <dt className="text-neutral-500">Exported at</dt>
        <dd className="font-mono text-black">{result.document.exportedAt}</dd>
      </dl>

      <SectionLabel>Independent lifecycle check</SectionLabel>
      <p className="text-xs text-black">{terminalLifecycleLabel(lifecycle)}</p>
      {lifecycle.kind === "pending" ? (
        <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs">
          <dt className="text-neutral-500">Live held balance</dt>
          <dd className="font-mono text-black">{lifecycle.open.heldBalanceMicro} micro USDC</dd>
          <dt className="text-neutral-500">Open state checked at</dt>
          <dd className="font-mono text-black">{lifecycle.open.checkedAt}</dd>
        </dl>
      ) : null}
      <ClaimBox>
        {lifecycle.kind === "verified"
          ? "Fresh Created and terminal checks matched this receipt. This confirms the on-chain escrow outcome, not a bank or cash payout."
          : lifecycle.kind === "pending"
            ? "A live check found the escrow still open. The terminal outcome carried in this receipt is not presented as current."
            : lifecycle.kind === "unavailable"
              ? "The live lifecycle could not be checked. Carried receipt fields remain available without a current outcome claim."
              : lifecycle.kind === "rejected"
                ? "Fresh lifecycle evidence did not match this receipt. No terminal outcome is claimed."
                : "Fresh Created and terminal checks are in progress. Carried receipt fields do not confirm the current outcome on their own."}
      </ClaimBox>
    </div>
  );
}

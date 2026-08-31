import {
  Copy,
  CopySuccess,
  DocumentDownload,
  ExportSquare,
} from "@/components/icons";
import { formatUsdcGrouped } from "@/lib/remittance/money";
import {
  type ProtectedTransferCreatedReceiptResult,
  type VerifiedProtectedTransferCreatedReceipt,
} from "@/lib/remittance/protected-transfer-created-receipt";
import type { CreatedCheckState } from "./proof-advanced-details";
import { ProofRejectionCard } from "./proof-rejection-card";
import { ProtectedTransferTerminalAction } from "./protected-transfer-terminal-action";

export interface ProtectedTransferCreatedPageCopy {
  eyebrow: string;
  title: string;
  intro: string;
}

interface ProtectedTransferCreatedReceiptProps {
  result: ProtectedTransferCreatedReceiptResult;
  createdVerify: CreatedCheckState;
  urlLoaded: boolean;
  copied: boolean;
  onShare: () => void;
  onExport: () => void;
  onRetry: () => void;
  onReviewDetails: () => void;
}

function compact(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function createdStatusLabel(state: CreatedCheckState): string {
  if (state.status === "verified") return "Hold confirmed on Sui";
  if (state.status === "not_found") return "Transaction not found on Sui testnet";
  if (state.status === "unavailable") return "Hold status unavailable";
  if (state.status === "rejected") return "Created event did not match this receipt";
  if (state.status === "error") return "Independent check failed";
  return "Re-checking Created event on Sui…";
}

export function protectedTransferCreatedPageCopy(
  result: ProtectedTransferCreatedReceiptResult,
  state: CreatedCheckState,
): ProtectedTransferCreatedPageCopy {
  if (!result.ok) {
    return {
      eyebrow: "Receipt · Needs review",
      title: "This hold receipt couldn't be verified.",
      intro:
        "The carried receipt could not be structurally verified. Review the details under Advanced details before relying on it.",
    };
  }
  if (state.status === "checking") {
    return {
      eyebrow: "Family review receipt · Checking",
      title: "Checking this family review receipt.",
      intro:
        "We’re checking whether the proposed hold was created on Sui. The amount below remains a receipt detail while the check runs.",
    };
  }
  if (state.status === "verified") {
    return {
      eyebrow: "Hold receipt · Confirmed on Sui",
      title: "Hold confirmed on Sui.",
      intro:
        "The Created event matches this receipt. The funds are held for your family reviewer; release or refund is a separate step.",
    };
  }
  if (state.status === "unavailable") {
    return {
      eyebrow: "Family review receipt · Status unavailable",
      title: "Family review status unavailable.",
      intro:
        "The independent Sui check is unavailable. The proposed amount below comes from the receipt and is not an on-chain confirmation.",
    };
  }
  if (state.status === "not_found") {
    return {
      eyebrow: "Family review receipt · Needs review",
      title: "This family review receipt needs review.",
      intro:
        "We could not find this transaction on Sui testnet. Review the receipt details before relying on the proposed amount below.",
    };
  }
  return {
    eyebrow: "Family review receipt · Needs review",
    title: "This family review receipt needs review.",
    intro:
      "The Created event does not match this receipt. Review the details before relying on the proposed amount below.",
  };
}

function CreatedReceiptActions({
  copied,
  explorerHref,
  onShare,
  onExport,
  onReviewDetails,
}: Pick<
  ProtectedTransferCreatedReceiptProps,
  "copied" | "onShare" | "onExport" | "onReviewDetails"
> & { explorerHref: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onShare}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        {copied ? (
          <CopySuccess size="14" variant="Bold" aria-hidden="true" />
        ) : (
          <Copy size="14" variant="Linear" aria-hidden="true" />
        )}
        {copied ? "Link copied" : "Copy share link"}
      </button>
      <button
        type="button"
        onClick={onExport}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        <DocumentDownload size="14" variant="Linear" aria-hidden="true" />
        Export proof
      </button>
      <a
        href={explorerHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        View transaction
        <ExportSquare size="13" variant="Linear" aria-hidden="true" />
      </a>
      <button
        type="button"
        onClick={onReviewDetails}
        className="inline-flex min-h-11 items-center rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        Review details
      </button>
    </div>
  );
}

function PendingReceiptActions({
  explorerHref,
  onReviewDetails,
}: Pick<ProtectedTransferCreatedReceiptProps, "onReviewDetails"> & {
  explorerHref: string;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <a
        href={explorerHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        Inspect transaction
        <ExportSquare size="13" variant="Linear" aria-hidden="true" />
      </a>
      <button
        type="button"
        onClick={onReviewDetails}
        className="inline-flex min-h-11 items-center rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        Review details
      </button>
    </div>
  );
}

function ReceiptDetails({
  receipt,
}: {
  receipt: VerifiedProtectedTransferCreatedReceipt;
}) {
  const transfer = receipt.document.transfer;
  return (
    <dl className="mt-5 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-3 border-y border-black/10 py-4 text-xs">
      <dt className="text-neutral-500">Beneficiary</dt>
      <dd className="text-black">{transfer.recipient}</dd>
      <dt className="text-neutral-500">Reviewer</dt>
      <dd className="text-black">{transfer.reviewerName}</dd>
      <dt className="text-neutral-500">Deadline</dt>
      <dd className="font-mono text-black">
        {new Date(transfer.deadlineMs).toLocaleString()}
      </dd>
      <dt className="text-neutral-500">Transaction mark</dt>
      <dd
        data-protected-transfer-created-digest
        className="truncate font-mono text-black"
        title={transfer.digest}
        data-full={transfer.digest}
      >
        {compact(transfer.digest)}
      </dd>
      <dt className="text-neutral-500">Review note</dt>
      <dd className="text-black">{transfer.reviewNote}</dd>
      <dt className="text-neutral-500">Receipt created</dt>
      <dd className="font-mono text-black">
        {new Date(transfer.createdCheckedAt).toLocaleString()}
      </dd>
    </dl>
  );
}

export function ProtectedTransferCreatedReceipt({
  result,
  createdVerify,
  urlLoaded,
  copied,
  onShare,
  onExport,
  onRetry,
  onReviewDetails,
}: ProtectedTransferCreatedReceiptProps) {
  if (!result.ok) {
    return (
      <ProofRejectionCard
        title="This hold receipt couldn't be verified."
        errors={result.errors}
      />
    );
  }

  const transfer = result.document.transfer;
  const createdVerified = createdVerify.status === "verified";
  return (
    <div data-testid="protected-transfer-created-result">
      <div
        data-testid="protected-transfer-created-stage"
        data-proof-mode={createdVerified ? "hold" : "proposed"}
        className="rounded-2xl bg-black p-5 text-white"
      >
        <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
          {createdVerified ? "Held for family review" : "Family review receipt"}
        </p>
        <p className="mt-3 text-[44px] font-medium leading-[0.92] tracking-[-0.04em] sm:text-[56px]">
          {formatUsdcGrouped(transfer.amountMicro)}
          <span className="ml-2 align-baseline text-[16px] font-semibold uppercase tracking-[0.16em] text-white/60 sm:text-[18px]">
            USDC
          </span>
        </p>
        <p className="mt-3 text-xs text-white/70">
          {createdVerified
            ? `Awaiting ${transfer.reviewerName}’s review`
            : `Reviewer: ${transfer.reviewerName}`}
        </p>
      </div>

      <p
        data-testid="protected-transfer-created-status"
        className="mt-4 text-xs font-semibold text-black"
        aria-live="polite"
      >
        {createdStatusLabel(createdVerify)}
      </p>
      {!createdVerified && createdVerify.status !== "checking" ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Re-check on Sui
        </button>
      ) : null}

      <div className="mt-5">
        <h2 className="text-xl tracking-[-0.025em] text-black">
          {createdVerified ? "Hold details" : "Proposed hold terms"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          {createdVerified
            ? `The funds are locked in escrow until ${transfer.reviewerName} reviews them or the deadline passes.`
            : "This receipt records the proposed hold terms while Convey checks the transaction on Sui."}
        </p>
        {urlLoaded ? (
          <p className="mt-3 text-xs text-neutral-500">
            This receipt is encoded in this link. Nothing was retrieved from server storage.
          </p>
        ) : null}
      </div>

      <ReceiptDetails receipt={result} />
      {createdVerified ? (
        <ProtectedTransferTerminalAction
          receipt={result}
          createdVerified
        />
      ) : null}
      {createdVerified ? (
        <CreatedReceiptActions
          copied={copied}
          explorerHref={transfer.explorerUrl}
          onShare={onShare}
          onExport={onExport}
          onReviewDetails={onReviewDetails}
        />
      ) : (
        <PendingReceiptActions
          explorerHref={transfer.explorerUrl}
          onReviewDetails={onReviewDetails}
        />
      )}
    </div>
  );
}

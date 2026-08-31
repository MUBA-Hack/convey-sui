import {
  Copy,
  CopySuccess,
  DocumentDownload,
  ExportSquare,
  Refresh,
} from "@/components/icons";
import { formatUsdcGrouped } from "@/lib/remittance/money";
import type {
  ProtectedTransferTerminalReceiptResult,
  VerifiedProtectedTransferTerminalReceipt,
} from "@/lib/remittance/protected-transfer-terminal-receipt";
import type { TerminalLifecycleState } from "./proof-advanced-details";
import { ProofRejectionCard } from "./proof-rejection-card";

export interface ProtectedTransferTerminalPageCopy {
  eyebrow: string;
  title: string;
  intro: string;
}

interface ProtectedTransferTerminalReceiptProps {
  result: ProtectedTransferTerminalReceiptResult;
  lifecycle: TerminalLifecycleState;
  urlLoaded: boolean;
  copied: boolean;
  onShare: () => void;
  onExport: () => void;
  onRetry: () => void;
  onReviewDetails: () => void;
}

export function protectedTransferTerminalPageCopy(
  result: ProtectedTransferTerminalReceiptResult,
  lifecycle: TerminalLifecycleState,
): ProtectedTransferTerminalPageCopy {
  if (!result.ok || lifecycle.kind === "rejected") {
    return {
      eyebrow: "Receipt · Needs review",
      title: "This transfer receipt needs review.",
      intro:
        "The receipt or its latest Sui evidence did not match. Review the details before relying on its recorded outcome.",
    };
  }
  if (lifecycle.kind === "checking") {
    return {
      eyebrow: "Receipt · Checking",
      title: "Checking the transfer outcome.",
      intro:
        "We’re checking the original hold and its latest outcome on Sui. The amount below remains a receipt detail while this runs.",
    };
  }
  if (lifecycle.kind === "unavailable") {
    return {
      eyebrow: "Receipt · Status unavailable",
      title: "Transfer status unavailable.",
      intro:
        "The live Sui check is unavailable. The recorded amount below is not a current outcome confirmation.",
    };
  }
  if (lifecycle.kind === "pending") {
    return {
      eyebrow: "Protected transfer · Confirmed open",
      title: "Your money is still protected.",
      intro:
        "A live Sui check found the hold still open. No release or refund is currently confirmed.",
    };
  }
  const released = lifecycle.terminal.action === "release";
  return {
    eyebrow: `Protected transfer · ${released ? "Released" : "Refunded"}`,
    title: released ? "Money released." : "Money refunded.",
    intro: released
      ? "The release event matches this receipt on Sui. This confirms the escrow outcome, not a bank or cash payout."
      : "The refund event matches this receipt on Sui. This confirms the escrow outcome on Sui.",
  };
}

function compact(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function outcomeText(lifecycle: TerminalLifecycleState): string {
  if (lifecycle.kind === "checking") return "Checking on Sui…";
  if (lifecycle.kind === "unavailable") return "Current status could not be checked";
  if (lifecycle.kind === "rejected") return "Receipt evidence did not match";
  if (lifecycle.kind === "pending") return "Still protected in the open hold";
  return lifecycle.terminal.action === "release"
    ? "Release confirmed on Sui"
    : "Refund confirmed on Sui";
}

function amountCaption(lifecycle: TerminalLifecycleState): string {
  if (lifecycle.kind === "checking") return "Recorded amount while the live check runs";
  if (lifecycle.kind === "pending") return "Confirmed in the open protected transfer";
  if (lifecycle.kind === "unavailable") return "Recorded amount · current status unavailable";
  if (lifecycle.kind === "rejected") return "Recorded amount · fresh evidence did not match";
  return lifecycle.terminal.action === "release"
    ? "Released to the beneficiary on Sui"
    : "Returned to the payer on Sui";
}

function detailsNarrative(lifecycle: TerminalLifecycleState): string {
  if (lifecycle.kind === "checking") {
    return "These carried receipt details do not establish the current outcome while the live check runs.";
  }
  if (lifecycle.kind === "unavailable") {
    return "These carried receipt details remain available, but the current outcome could not be checked.";
  }
  if (lifecycle.kind === "rejected") {
    return "These carried receipt details remain available, but fresh Sui evidence did not match them.";
  }
  if (lifecycle.kind === "pending") {
    return "A live Sui check confirms these protection details and found the hold still open.";
  }
  return lifecycle.terminal.action === "release"
    ? "Fresh Sui evidence confirms this release and matches the carried receipt details."
    : "Fresh Sui evidence confirms this refund and matches the carried receipt details.";
}

function conciseDate(value: number | string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ReceiptDetails({ receipt }: { receipt: VerifiedProtectedTransferTerminalReceipt }) {
  const transfer = receipt.document.transfer;
  const created = receipt.document.created.transfer;
  return (
    <dl
      data-testid="protected-transfer-terminal-details"
      className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-y border-black/10 py-4 text-xs sm:grid-cols-3 sm:gap-x-6"
    >
      <div className="min-w-0">
        <dt className="text-neutral-500">Beneficiary</dt>
        <dd className="mt-1.5 truncate font-medium text-black">{created.recipient}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-neutral-500">Reviewer</dt>
        <dd className="mt-1.5 truncate font-medium text-black" title={created.reviewerName}>
          {created.reviewerName}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-neutral-500">Deadline</dt>
        <dd className="mt-1.5 font-mono leading-5 text-black">
          {conciseDate(transfer.deadlineMs)}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-neutral-500">Recorded check</dt>
        <dd className="mt-1.5 font-mono leading-5 text-black">
          {conciseDate(transfer.terminalCheckedAt)}
        </dd>
      </div>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <dt className="text-neutral-500">Transaction mark</dt>
        <dd className="mt-1.5 truncate font-mono text-black" title={transfer.digest}>
          {compact(transfer.digest)}
        </dd>
      </div>
    </dl>
  );
}

export function ProtectedTransferTerminalReceipt({
  result,
  lifecycle,
  urlLoaded,
  copied,
  onShare,
  onExport,
  onRetry,
  onReviewDetails,
}: ProtectedTransferTerminalReceiptProps) {
  if (!result.ok) {
    return (
      <ProofRejectionCard
        title="This transfer receipt couldn't be verified."
        errors={result.errors}
      />
    );
  }

  const transfer = result.document.transfer;
  const verified = lifecycle.kind === "verified";
  const pending = lifecycle.kind === "pending";
  const released = verified && lifecycle.terminal.action === "release";
  const outcome = verified ? (released ? "Released" : "Refunded") : pending ? "Protected" : "Receipt amount";

  return (
    <div data-testid="protected-transfer-terminal-result">
      <div
        data-testid="protected-transfer-terminal-stage"
        data-proof-mode={verified ? lifecycle.terminal.action : lifecycle.kind}
        className="rounded-2xl bg-black p-5 text-white sm:p-6"
      >
        <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
          {outcome}
        </p>
        <p className="mt-3 text-[44px] font-medium leading-[0.92] tracking-[-0.04em] sm:text-[56px]">
          {formatUsdcGrouped(transfer.amountMicro)}
          <span className="ml-2 align-baseline text-[16px] font-semibold uppercase tracking-[0.16em] text-white/60 sm:text-[18px]">
            USDC
          </span>
        </p>
        <p className="mt-3 text-xs leading-5 text-white/70">
          {amountCaption(lifecycle)}
        </p>
      </div>

      <p
        data-testid="protected-transfer-terminal-status"
        className="mt-4 text-xs font-semibold text-black"
        aria-live="polite"
      >
        {outcomeText(lifecycle)}
      </p>

      {(lifecycle.kind === "unavailable" || lifecycle.kind === "rejected") ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition-colors motion-reduce:transition-none hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <Refresh size="14" variant="Linear" aria-hidden="true" />
          Check again
        </button>
      ) : null}

      <div className="mt-5">
        <h2 className="text-xl tracking-[-0.025em] text-black">
          {verified ? "Outcome details" : pending ? "Protection details" : "Receipt details"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          {detailsNarrative(lifecycle)}
        </p>
        {urlLoaded ? (
          <p className="mt-3 text-xs text-neutral-500">
            This receipt is encoded in this link. Its current status is checked independently.
          </p>
        ) : null}
      </div>

      <ReceiptDetails receipt={result} />
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {verified ? (
          <>
            <button
              type="button"
              onClick={onShare}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition-colors motion-reduce:transition-none hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
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
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition-colors motion-reduce:transition-none hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              <DocumentDownload size="14" variant="Linear" aria-hidden="true" />
              Export receipt
            </button>
            <a
              href={transfer.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition-colors motion-reduce:transition-none hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              View transaction
              <ExportSquare size="13" variant="Linear" aria-hidden="true" />
            </a>
          </>
        ) : null}
        <button
          type="button"
          onClick={onReviewDetails}
          className="inline-flex min-h-11 items-center rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition-colors motion-reduce:transition-none hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Review details
        </button>
      </div>
    </div>
  );
}

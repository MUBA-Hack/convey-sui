import {
  Copy,
  CopySuccess,
  DocumentDownload,
  ExportSquare,
} from "@/components/icons";
import {
  buildBaseScanTransactionUrl,
  ProtectionPurchaseVerifyResponseSchema,
  type ProtectionPurchaseReceiptDocument,
  type ProtectionPurchaseVerifyResponse,
  type VerifiedProtectionPurchase,
} from "@/lib/strategy/protection-purchase-receipt";
import {
  formatProtectionExpirySeconds,
  formatStrike8d,
  formatUsdcMicro,
} from "@/lib/strategy/format";
import { ProofRejectionCard } from "./proof-rejection-card";

export type ProtectionPurchaseReceiptResult =
  | { ok: true; receipt: ProtectionPurchaseReceiptDocument }
  | { ok: false; errors: string[] };

export type ProtectionPurchaseCheckState =
  | { kind: "checking" }
  | ProtectionPurchaseVerifyResponse
  | { kind: "unavailable"; reason: "invalid_response" };

const PURCHASE_COMPARISON_FIELDS = [
  "network",
  "chainId",
  "txHash",
  "blockNumber",
  "buyerAddress",
  "makerAddress",
  "optionAddress",
  "nonce",
  "premiumAmountMicro",
  "feeCollectedMicro",
  "referralFeePaidMicro",
  "referrerAddress",
  "sellerWasMaker",
] as const satisfies ReadonlyArray<keyof VerifiedProtectionPurchase>;

export function parseProtectionPurchaseCheckResponse(
  value: unknown,
  receipt: ProtectionPurchaseReceiptDocument,
): ProtectionPurchaseCheckState {
  const parsed = ProtectionPurchaseVerifyResponseSchema.safeParse(value);
  if (!parsed.success) return { kind: "unavailable", reason: "invalid_response" };
  if (parsed.data.kind !== "verified") return parsed.data;
  const verified = parsed.data;
  const matches = PURCHASE_COMPARISON_FIELDS.every(
    (field) => verified[field] === receipt.purchase[field],
  );
  return matches
    ? verified
    : { kind: "rejected", reason: "transaction_mismatch" };
}

export interface ProtectionPurchasePageCopy {
  eyebrow: string;
  title: string;
  intro: string;
}

export function protectionPurchasePageCopy(
  state: ProtectionPurchaseCheckState,
): ProtectionPurchasePageCopy {
  if (state.kind === "checking") {
    return {
      eyebrow: "Protection receipt · Checking",
      title: "Checking this protection purchase.",
      intro:
        "We’re matching the purchase and protection terms on Base. The details below remain receipt information while the check runs.",
    };
  }
  if (state.kind === "verified") {
    return {
      eyebrow: "Protection receipt · Confirmed on Base",
      title: "Protection purchase confirmed.",
      intro:
        "The Base transaction matches this receipt and its protection plan.",
    };
  }
  if (state.kind === "pending") {
    return {
      eyebrow: "Protection receipt · Pending",
      title: "Purchase confirmation is still pending.",
      intro:
        "Base has not returned this transaction yet. The terms below come from the receipt and are not a current on-chain confirmation.",
    };
  }
  if (state.kind === "unavailable") {
    return {
      eyebrow: "Protection receipt · Status unavailable",
      title: "Purchase status unavailable.",
      intro:
        "The independent Base check is unavailable. The terms below come from the receipt and are not a current on-chain confirmation.",
    };
  }
  return {
    eyebrow: "Protection receipt · Needs review",
    title: "This protection receipt needs review.",
    intro:
      "The Base transaction did not match this receipt. Review the details before relying on the protection terms below.",
  };
}

function statusCopy(state: ProtectionPurchaseCheckState): {
  title: string;
  body: string;
} {
  if (state.kind === "checking") {
    return {
      title: "Checking purchase on Base",
      body: "Matching the transaction, buyer, premium, and protection terms.",
    };
  }
  if (state.kind === "verified") {
    return {
      title: "Confirmed on Base",
      body: "The purchase event and protection plan match this receipt.",
    };
  }
  if (state.kind === "pending") {
    return {
      title: "Transaction not found yet",
      body: "Base has not returned this transaction. It may still be indexing or pending.",
    };
  }
  if (state.kind === "unavailable") {
    return {
      title: "Base check unavailable",
      body: "No independent Base result is available right now.",
    };
  }
  return {
    title: "Receipt doesn’t match Base",
    body: "The transaction result differs from this portable receipt.",
  };
}

export function ProtectionPurchaseProof({
  result,
  state,
  urlLoaded,
  copied,
  onShare,
  onExport,
  onRetry,
  onReviewDetails,
}: {
  result: ProtectionPurchaseReceiptResult;
  state: ProtectionPurchaseCheckState;
  urlLoaded: boolean;
  copied: boolean;
  onShare: () => void;
  onExport: () => void;
  onRetry: () => void;
  onReviewDetails: () => void;
}) {
  if (!result.ok) {
    return (
      <ProofRejectionCard
        title="This protection receipt couldn't be verified."
        errors={result.errors}
      />
    );
  }
  const receipt = result.receipt;
  const verified = state.kind === "verified";
  const status = statusCopy(state);
  const explorerHref = buildBaseScanTransactionUrl(receipt.purchase.txHash);
  const floor = receipt.plan.strikes8d[0] ?? "0";

  return (
    <div data-testid="protection-purchase-result">
      <div
        data-testid="protection-purchase-stage"
        data-proof-mode={verified ? "verified" : "receipt"}
        className="rounded-2xl bg-black p-5 text-white"
      >
        <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
          {verified ? "Protection confirmed" : "Protection receipt"}
        </p>
        <p className="mt-3 text-[44px] font-medium leading-[0.92] tracking-[-0.04em] sm:text-[56px]">
          {formatStrike8d(floor)}
          <span className="ml-2 align-baseline text-[16px] font-semibold uppercase tracking-[0.12em] text-white/60 sm:text-[18px]">
            floor
          </span>
        </p>
        <p className="mt-3 text-xs text-white/70">
          {receipt.plan.asset} · until{" "}
          {formatProtectionExpirySeconds(receipt.plan.expirySeconds)}
        </p>
      </div>

      <section
        data-testid="protection-purchase-status"
        data-purchase-status={state.kind}
        aria-live="polite"
        className={`mt-4 rounded-2xl border p-5 ${verified ? "border-black/10 bg-white" : "border-black bg-black text-white"}`}
      >
        <p className={`font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] ${verified ? "text-neutral-500" : "text-white/60"}`}>
          Purchase status
        </p>
        <h2 className={`mt-2 text-xl font-semibold tracking-[-0.025em] ${verified ? "text-black" : "text-white"}`}>
          {status.title}
        </h2>
        <p className={`mt-2 text-sm leading-6 ${verified ? "text-neutral-600" : "text-white/75"}`}>
          {status.body}
        </p>
        {state.kind === "pending" || state.kind === "unavailable" ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 text-xs font-semibold text-black transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Check again
          </button>
        ) : state.kind === "rejected" ? (
          <button
            type="button"
            onClick={onReviewDetails}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 text-xs font-semibold text-black transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Review details
          </button>
        ) : null}
      </section>

      {urlLoaded ? (
        <p className="mt-3 text-xs text-neutral-500">
          This receipt is encoded in this link. Nothing was retrieved from server storage.
        </p>
      ) : null}

      <dl className="mt-5 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-3 border-y border-black/10 py-4 text-xs">
        <dt className="text-neutral-500">Cost paid</dt>
        <dd className="text-black">{formatUsdcMicro(receipt.purchase.premiumAmountMicro)} USDC</dd>
        <dt className="text-neutral-500">Asset</dt>
        <dd className="text-black">{receipt.plan.asset}</dd>
        <dt className="text-neutral-500">Wallet</dt>
        <dd className="truncate font-mono text-black" title={receipt.purchase.buyerAddress}>
          {receipt.purchase.buyerAddress}
        </dd>
        <dt className="text-neutral-500">Network</dt>
        <dd className="text-black">Base</dd>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {verified ? (
          <>
            <button
              type="button"
              onClick={onShare}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              {copied ? <CopySuccess size="14" variant="Bold" aria-hidden="true" /> : <Copy size="14" variant="Linear" aria-hidden="true" />}
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
          </>
        ) : null}
        <a
          href={explorerHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          {verified ? "View transaction" : "Inspect transaction"}
          <ExportSquare size="13" variant="Linear" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

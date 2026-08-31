"use client";

import { useEffect, useRef, useState } from "react";
import {
  Copy,
  CopySuccess,
  DocumentDownload,
  ExportSquare,
  ShieldSearch,
} from "@/components/icons";
import {
  decodeReceiptProofPayload,
  encodeReceiptProofPayload,
  type ReceiptProofResult,
  verifyReceiptProof,
} from "@/lib/commerce/receipt-proof";
import {
  decodeRemittanceReceiptPayload,
  encodeRemittanceReceiptPayload,
  sniffProofKind,
  verifyRemittanceReceipt,
  type RemittanceReceiptResult,
  type VerifiedRemittanceReceipt,
} from "@/lib/remittance/receipt-proof";
import {
  decodeProtectedTransferCreatedReceiptPayload,
  encodeProtectedTransferCreatedReceiptPayload,
  PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM,
  verifyProtectedTransferCreatedReceipt,
} from "@/lib/remittance/protected-transfer-created-receipt";
import { decodeHandoff } from "@/lib/remittance/offline-handoff";
import {
  formatMyrGrouped,
  formatMyrFixedGrouped,
  formatPhpFixedGrouped,
  formatUsdcGrouped,
} from "@/lib/remittance/money";
import { RemittanceMoneySlab } from "@/components/remittance/remittance-money-slab";
import { copyReceiptUrl, exportReceiptJson } from "@/lib/remittance/receipt-share";
import {
  CHECKING_CREATED,
  EMPTY_VIEW,
  ProofAdvancedDetails,
  type CreatedCheckState,
  type EvidenceView,
  type QuoteVerifyStatus,
} from "./proof-advanced-details";
import {
  FamilyPayoutStatus,
  parseSettlementCheckResponse,
  RemittanceSettlementStatus,
  type SettlementCheckState,
} from "./remittance-settlement-status";
import { checkProtectedTransferCreatedReceipt } from "./protected-transfer-created-check";
import {
  ProtectedTransferCreatedReceipt,
  protectedTransferCreatedPageCopy,
} from "./protected-transfer-created-receipt";
import { ProofRejectionCard } from "./proof-rejection-card";

const CHECKING_SETTLEMENT: SettlementCheckState = { status: "checking" };

interface ReceiptPageCopy {
  eyebrow: string;
  title: string;
  intro: string;
}

const DEFAULT_RECEIPT_PAGE_COPY: ReceiptPageCopy = {
  eyebrow: "Receipt",
  title: "Your receipt, in plain terms.",
  intro:
    "Open a Convey receipt link to see the amount, recipient, and status of your transfer. The full technical verification stays available under Advanced details.",
};

function remittancePageCopy(view: EvidenceView): ReceiptPageCopy {
  if (view.kind === "protected-transfer-created") {
    return protectedTransferCreatedPageCopy(view.result, view.createdVerify);
  }
  if (view.kind !== "remittance" || !view.result.ok) {
    return DEFAULT_RECEIPT_PAGE_COPY;
  }
  const state = view.settlementVerify;
  if (state.status === "checking") {
    return {
      eyebrow: "Receipt · Checking",
      title: "Checking this transfer.",
      intro:
        "We’re matching the receipt’s transaction, recipient, and USDC amount on Sui. The amounts below remain receipt details while the check runs.",
    };
  }
  if (state.status === "verified") {
    return {
      eyebrow: "Receipt · Confirmed on Sui",
      title: "Transfer confirmed on Sui.",
      intro:
        "The Sui transaction matches this receipt. Family payout remains a separate status.",
    };
  }
  if (state.status === "unavailable") {
    return {
      eyebrow: "Receipt · Status unavailable",
      title: "Transfer status unavailable.",
      intro:
        "The independent Sui check is unavailable. The amounts below come from the receipt and are not an on-chain confirmation.",
    };
  }
  const notFound = state.reason === "transaction_not_found";
  return {
    eyebrow: "Receipt · Needs review",
    title: "This transfer needs review.",
    intro: notFound
      ? "We could not find this transaction on Sui testnet. Review the receipt details before relying on the amounts below."
      : "The Sui transaction does not match this receipt. Review the details before relying on the amounts below.",
  };
}

function mistToSui(mist: string): string {
  const value = BigInt(mist);
  const whole = value / 1_000_000_000n;
  const fraction = value % 1_000_000_000n;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

function compact(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ProofVerifier() {
  const [raw, setRaw] = useState("");
  const [view, setView] = useState<EvidenceView>(EMPTY_VIEW);
  const [copied, setCopied] = useState(false);
  const [urlLoaded, setUrlLoaded] = useState(false);
  const [settlementRetry, setSettlementRetry] = useState(0);
  const [createdRetry, setCreatedRetry] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const verifySeq = useRef(0);
  const settlementVerifySeq = useRef(0);
  const createdVerifySeq = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const remittancePayload = params.get("r");
    const commercePayload = params.get("p");
    const createdPayload = params.get(PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM);
    if (!remittancePayload && !commercePayload && !createdPayload) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        if (remittancePayload) {
          const doc = decodeRemittanceReceiptPayload(remittancePayload);
          const json = JSON.stringify(doc, null, 2);
          setRaw(json);
          setView({
            kind: "remittance",
            result: verifyRemittanceReceipt(doc),
            quoteVerify: "checking",
            settlementVerify: CHECKING_SETTLEMENT,
          });
          setUrlLoaded(true);
        } else if (createdPayload) {
          const doc = decodeProtectedTransferCreatedReceiptPayload(createdPayload);
          const json = JSON.stringify(doc, null, 2);
          setRaw(json);
          setView({
            kind: "protected-transfer-created",
            result: verifyProtectedTransferCreatedReceipt(doc),
            createdVerify: CHECKING_CREATED,
          });
          setUrlLoaded(true);
        } else if (commercePayload) {
          const proof = decodeReceiptProofPayload(commercePayload);
          const json = JSON.stringify(proof, null, 2);
          setRaw(json);
          setView({ kind: "commerce", result: verifyReceiptProof(proof) });
          setUrlLoaded(true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Shared proof payload is invalid.";
        if (remittancePayload) {
          setView({
            kind: "remittance",
            result: { ok: false, errors: [message] },
            quoteVerify: "error",
            settlementVerify: CHECKING_SETTLEMENT,
          });
        } else if (createdPayload) {
          setView({
            kind: "protected-transfer-created",
            result: { ok: false, errors: [message] },
            createdVerify: { status: "error" },
          });
        } else {
          setView({
            kind: "commerce",
            result: { ok: false, errors: [message] },
          });
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  // Re-check the signed quote against the server before presenting quote
  // authorization as verified. Honest: this page does not query Sui tx state.
  // Uses historical evidence mode (`?evidence=1`) so an expired quote inside a
  // receipt can still be confirmed as genuinely attested without ever turning
  // into an executable authorization. The server returns `kind: "evidence"`
  // for an expired-but-genuine quote and `kind: "authorization"` for an
  // unexpired one; both are truthful "signed/verified" outcomes. A rejected
  // or unavailable check never shows verified wording.
  const activeQuote =
    view.kind === "remittance" && view.result.ok ? view.result.document.quote : null;
  useEffect(() => {
    if (!activeQuote) return;
    const seq = ++verifySeq.current;
    let active = true;
    void (async () => {
      let next: QuoteVerifyStatus = "error";
      try {
        const res = await fetch("/api/remittance/quote/verify?evidence=1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(activeQuote),
        });
        if (res.ok) {
          const body = (await res.json()) as { kind?: string };
          if (body.kind === "authorization") next = "verified";
          else if (body.kind === "evidence") next = "evidence";
          else next = "rejected";
        } else {
          next = "rejected";
        }
      } catch {
        next = "error";
      }
      if (!active || verifySeq.current !== seq) return;
      setView((v) =>
        v.kind === "remittance" && v.result.ok ? { ...v, quoteVerify: next } : v,
      );
    })();
    return () => {
      active = false;
    };
  }, [activeQuote]);

  const activeReceipt =
    view.kind === "remittance" && view.result.ok ? view.result.document : null;
  useEffect(() => {
    if (!activeReceipt) return;
    const seq = ++settlementVerifySeq.current;
    const controller = new AbortController();
    let active = true;
    void (async () => {
      let next: SettlementCheckState;
      try {
        const response = await fetch("/api/remittance/settlement/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(activeReceipt),
          signal: controller.signal,
        });
        if (!response.ok) {
          next = { status: "unavailable", reason: "invalid_response" };
        } else {
          try {
            next = parseSettlementCheckResponse(await response.json(), {
              digest: activeReceipt.settlement.digest,
              recipientAddress: activeReceipt.settlement.recipientAddress,
              receivedMicro: activeReceipt.settlement.usdcMicro,
            });
          } catch {
            next = { status: "unavailable", reason: "invalid_response" };
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        next = { status: "unavailable", reason: "rpc_unavailable" };
      }
      if (!active || settlementVerifySeq.current !== seq) return;
      setView((current) =>
        current.kind === "remittance" &&
        current.result.ok &&
        current.result.document === activeReceipt
          ? { ...current, settlementVerify: next }
          : current,
      );
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeReceipt, settlementRetry]);

  const activeCreatedReceipt =
    view.kind === "protected-transfer-created" && view.result.ok
      ? view.result.document
      : null;
  useEffect(() => {
    if (!activeCreatedReceipt) return;
    const seq = ++createdVerifySeq.current;
    const controller = new AbortController();
    let active = true;
    void (async () => {
      let next: CreatedCheckState;
      try {
        next = await checkProtectedTransferCreatedReceipt(
          activeCreatedReceipt,
          controller.signal,
        );
      } catch {
        return;
      }
      if (!active || createdVerifySeq.current !== seq) return;
      setView((current) =>
        current.kind === "protected-transfer-created" &&
        current.result.ok &&
        current.result.document === activeCreatedReceipt
          ? { ...current, createdVerify: next }
          : current,
      );
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeCreatedReceipt, createdRetry]);

  const handleRawChange = (value: string) => {
    setRaw(value);
    setView(EMPTY_VIEW);
    setUrlLoaded(false);
  };

  const handleVerify = () => {
    setUrlLoaded(false);
    const kind = sniffProofKind(raw);
    if (kind === "remittance-receipt") {
      setView({
        kind: "remittance",
        result: verifyRemittanceReceipt(raw),
        quoteVerify: "checking",
        settlementVerify: CHECKING_SETTLEMENT,
      });
      return;
    }
    if (kind === "protected-transfer-created-receipt") {
      setView({
        kind: "protected-transfer-created",
        result: verifyProtectedTransferCreatedReceipt(raw),
        createdVerify: CHECKING_CREATED,
      });
      return;
    }
    if (kind === "remittance-quote") {
      try {
        const handoff = decodeHandoff(raw);
        setView({
          kind: "remittance-unsettled",
          recipient: handoff.quote.recipient,
          destinationCity: handoff.quote.destinationCity,
        });
      } catch {
        setView({
          kind: "remittance-unsettled",
          recipient: null,
          destinationCity: null,
        });
      }
      return;
    }
    // commerce (and unknown → legacy commerce verify preserves prior behavior).
    setView({ kind: "commerce", result: verifyReceiptProof(raw) });
  };

  const handleDemoSample = () => {
    const sample = {
      mode: "demo" as const,
      demo: true,
      digest: "DEMO-abcdef0123456789",
      amountMist: "2500000000",
      merchantAddress: `0x${"11".repeat(32)}`,
      explorerUrl: null,
      label: "DEMO simulation — no on-chain settlement",
      exportedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(sample, null, 2);
    setRaw(json);
    setUrlLoaded(false);
    setView({ kind: "commerce", result: verifyReceiptProof(sample) });
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setRaw(text);
      setView(EMPTY_VIEW);
      setUrlLoaded(false);
    } catch {
      setView({
        kind: "commerce",
        result: { ok: false, errors: ["The selected file could not be read."] },
      });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleCommerceShare = async () => {
    if (view.kind !== "commerce" || !view.result.ok) return;
    const payload = encodeReceiptProofPayload(view.result.document);
    const ok = await copyReceiptUrl(payload, "p");
    setCopied(ok);
  };

  const handleRemittanceShare = async () => {
    if (view.kind !== "remittance" || !view.result.ok) return;
    const payload = encodeRemittanceReceiptPayload(view.result.document);
    const ok = await copyReceiptUrl(payload, "r");
    setCopied(ok);
  };

  const handleRemittanceExport = () => {
    if (view.kind !== "remittance" || !view.result.ok) return;
    exportReceiptJson(view.result.document, "convey-remittance-proof.json");
  };

  const handleCreatedShare = async () => {
    if (view.kind !== "protected-transfer-created" || !view.result.ok) return;
    const payload = encodeProtectedTransferCreatedReceiptPayload(view.result.document);
    const ok = await copyReceiptUrl(payload, PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM);
    setCopied(ok);
  };

  const handleCreatedExport = () => {
    if (view.kind !== "protected-transfer-created" || !view.result.ok) return;
    exportReceiptJson(view.result.document, "convey-protected-transfer-created.json");
  };

  const handleRetryCreated = () => {
    setView((current) =>
      current.kind === "protected-transfer-created" && current.result.ok
        ? { ...current, createdVerify: CHECKING_CREATED }
        : current,
    );
    setCreatedRetry((value) => value + 1);
  };

  const handleReviewDetails = () => {
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="proof-advanced-trigger"]',
    );
    if (trigger?.getAttribute("aria-expanded") !== "true") trigger?.click();
    trigger?.focus();
  };

  const handleRetrySettlement = () => {
    setView((current) =>
      current.kind === "remittance" && current.result.ok
        ? { ...current, settlementVerify: CHECKING_SETTLEMENT }
        : current,
    );
    setSettlementRetry((value) => value + 1);
  };

  const pageCopy = remittancePageCopy(view);

  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-3 py-1 font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-700">
          <ShieldSearch size="14" variant="Linear" aria-hidden="true" />
          {pageCopy.eyebrow}
        </span>
        <h1
          data-testid="receipt-page-title"
          className="mt-4 text-4xl font-normal tracking-[-0.05em] text-black sm:text-5xl"
        >
          {pageCopy.title}
        </h1>
        <p
          data-testid="receipt-page-intro"
          className="mt-4 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base"
        >
          {pageCopy.intro}
        </p>
      </div>

      {/* Result-first: the receipt is the protagonist. When a share link
          hydrates a result it leads the page; the JSON editor and structural
          checks stay subordinate under Advanced details. */}
      <div data-proof-panel="result" aria-label="Receipt">
        {view.kind === "empty" ? (
          <EmptyState />
        ) : view.kind === "commerce" ? (
          <CommerceReceipt
            result={view.result}
            urlLoaded={urlLoaded}
            copied={copied}
            onShare={handleCommerceShare}
          />
        ) : view.kind === "remittance" ? (
          <RemittanceReceipt
            result={view.result}
            quoteVerify={view.quoteVerify}
            settlementVerify={view.settlementVerify}
            urlLoaded={urlLoaded}
            copied={copied}
            onShare={handleRemittanceShare}
            onExport={handleRemittanceExport}
            onRetrySettlement={handleRetrySettlement}
            onReviewDetails={handleReviewDetails}
          />
        ) : view.kind === "protected-transfer-created" ? (
          <ProtectedTransferCreatedReceipt
            result={view.result}
            createdVerify={view.createdVerify}
            urlLoaded={urlLoaded}
            copied={copied}
            onShare={handleCreatedShare}
            onExport={handleCreatedExport}
            onRetry={handleRetryCreated}
            onReviewDetails={handleReviewDetails}
          />
        ) : (
          <RemittanceUnsettled
            recipient={view.recipient}
            destinationCity={view.destinationCity}
          />
        )}
      </div>

      <ProofAdvancedDetails
        raw={raw}
        onRawChange={handleRawChange}
        onVerify={handleVerify}
        onLoadSample={handleDemoSample}
        onImportFile={handleFile}
        fileRef={fileRef}
        view={view}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty state — customer-facing, no engineering labels.
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8">
      <h2 className="text-2xl tracking-[-0.035em] text-black">No receipt open yet.</h2>
      <p className="mt-3 text-sm leading-6 text-neutral-600">
        Open a Convey receipt link, or expand Advanced details to paste or import a receipt.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commerce receipt — customer-first. Honest boundary stays in the result;
// canonical fields, structural checks, and the technical claim live under
// Advanced details.
// ---------------------------------------------------------------------------

function CommerceReceipt({
  result,
  urlLoaded,
  copied,
  onShare,
}: {
  result: ReceiptProofResult;
  urlLoaded: boolean;
  copied: boolean;
  onShare: () => void;
}) {
  if (!result.ok) {
    return <ProofRejectionCard title="This receipt couldn't be verified." errors={result.errors} />;
  }

  const isDemo = result.kind === "demo_structure";
  const receipt = result.receipt;
  const explorerHref = receipt.explorerUrl;

  return (
    <div data-testid="proof-result" aria-live="polite">
      <div
        data-testid="proof-stage"
        data-proof-mode={isDemo ? "demo" : "real"}
        className="rounded-2xl bg-black p-5 text-white"
      >
        <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
          {isDemo ? "Sample receipt" : "Receipt"}
        </p>
        <p className="mt-3 text-[44px] font-medium leading-[0.92] tracking-[-0.04em] sm:text-[56px]">
          {mistToSui(receipt.amountMist)}
          <span className="ml-2 align-baseline text-[16px] font-semibold uppercase tracking-[0.16em] text-white/60 sm:text-[18px]">
            SUI
          </span>
        </p>
        <div className="mt-4 min-w-0">
          <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
            Transaction mark
          </p>
          <p
            data-proof-digest
            className="mt-1 truncate font-mono text-xs text-white"
            title={receipt.digest}
            data-full={receipt.digest}
          >
            {compact(receipt.digest)}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <h2 className="text-2xl tracking-[-0.035em] text-black">
          {isDemo ? "Sample receipt" : "Receipt checked"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          {isDemo
            ? "This is a sample receipt. No payment was sent and no chain was queried."
            : "Receipt details were checked. This page did not look up the transaction on Sui."}
        </p>
        {urlLoaded ? (
          <p className="mt-3 text-xs text-neutral-500">
            This receipt is encoded in this link. Nothing was retrieved from server storage.
          </p>
        ) : null}
      </div>

      <dl className="mt-5 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-3 border-y border-black/10 py-4 text-xs">
        <dt className="text-neutral-500">Merchant</dt>
        <dd className="truncate font-mono text-black" title={receipt.merchantAddress}>
          {compact(receipt.merchantAddress)}
        </dd>
        <dt className="text-neutral-500">Exported</dt>
        <dd className="font-mono text-black">{new Date(result.document.exportedAt).toLocaleString()}</dd>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onShare}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          {copied ? <CopySuccess size="14" variant="Bold" aria-hidden="true" /> : <Copy size="14" variant="Linear" aria-hidden="true" />}
          {copied ? "Link copied" : "Copy share link"}
        </button>
        {explorerHref ? (
          <a
            href={explorerHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            View transaction
            <ExportSquare size="13" variant="Linear" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remittance receipt — customer-first. Quote/seal status, payout, amounts,
// and customer actions lead; canonical fields, structural checks, family-rule
// binding, and the technical claim live under Advanced details.
// ---------------------------------------------------------------------------

function quoteVerifyLabel(status: QuoteVerifyStatus): string {
  switch (status) {
    case "verified":
      return "Quote re-verified";
    case "evidence":
      return "Quote verified (historical record — no longer valid for payment)";
    case "rejected":
      return "Quote could not be re-verified";
    case "error":
      return "Quote check unavailable";
    case "checking":
    default:
      return "Re-checking quote…";
  }
}

function isServerVerified(status: QuoteVerifyStatus): boolean {
  return status === "verified" || status === "evidence";
}

/** Customer-facing family rule — purpose and limit only, no seal language. */
function familyRuleCustomer(quote: VerifiedRemittanceReceipt["document"]["quote"]): string {
  const { purpose, maximumFamilyLimitMinor } = quote.intentReview;
  if (purpose && maximumFamilyLimitMinor) {
    return `Family rule · ${titleCase(purpose)} · Within RM${formatMyrGrouped(maximumFamilyLimitMinor)} maximum`;
  }
  if (purpose) return `Family rule · ${titleCase(purpose)}`;
  if (maximumFamilyLimitMinor) return `Family rule · Within RM${formatMyrGrouped(maximumFamilyLimitMinor)} maximum`;
  return "No family rule stated";
}

function RemittanceReceipt({
  result,
  quoteVerify,
  settlementVerify,
  urlLoaded,
  copied,
  onShare,
  onExport,
  onRetrySettlement,
  onReviewDetails,
}: {
  result: RemittanceReceiptResult;
  quoteVerify: QuoteVerifyStatus;
  settlementVerify: SettlementCheckState;
  urlLoaded: boolean;
  copied: boolean;
  onShare: () => void;
  onExport: () => void;
  onRetrySettlement: () => void;
  onReviewDetails: () => void;
}) {
  if (!result.ok) {
    return <ProofRejectionCard title="This remittance receipt couldn't be verified." errors={result.errors} />;
  }

  const ok: VerifiedRemittanceReceipt = result;
  const quote = ok.document.quote;
  const settlement = ok.document.settlement;
  const usdcAmount = formatUsdcGrouped(quote.usdcMicro);
  const youPayFixed = formatMyrFixedGrouped(quote.youPayMinor);
  const familyReceivesFixed = formatPhpFixedGrouped(quote.familyReceivesMinor);
  const fee = formatMyrGrouped(quote.totalFeeMinor);
  const explorerHref = settlement.explorerUrl;
  const settlementVerified = settlementVerify.status === "verified";
  const moneySlab = (
    <RemittanceMoneySlab
      receiveLabel={`${titleCase(quote.recipient)} · estimated receive`}
      sendAmount={`RM${youPayFixed}`}
      receiveAmount={`${quote.familyReceivesCurrency} ${familyReceivesFixed}`}
      testId="remittance-stage"
      dataProofMode="remittance"
      tone={settlementVerified ? "primary" : "subordinate"}
      className={settlementVerified ? "" : "mt-3"}
    />
  );
  const destination = (
    <p className="mt-2 text-xs text-neutral-500">
      {titleCase(quote.recipient)} · {titleCase(quote.destinationCity)}, {quote.destinationCountry}
    </p>
  );
  const transferStatus = (
    <RemittanceSettlementStatus
      state={settlementVerify}
      onRetry={onRetrySettlement}
      onReview={onReviewDetails}
    />
  );

  return (
    <div data-testid="remittance-result">
      {settlementVerified ? (
        <>
          {moneySlab}
          {destination}
          {transferStatus}
        </>
      ) : (
        <>
          {transferStatus}
          {moneySlab}
          {destination}
        </>
      )}
      <FamilyPayoutStatus
        recipient={titleCase(quote.recipient)}
        settlementVerified={settlementVerified}
      />

      <div className="mt-5">
        <h2 className="text-xl tracking-[-0.025em] text-black">Receipt details checked</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          Receipt details and the linked quote are checked separately from the Sui transfer status above.
        </p>
        {urlLoaded ? (
          <p className="mt-3 text-xs text-neutral-500">
            This receipt is encoded in this link. Nothing was retrieved from server storage.
          </p>
        ) : null}
      </div>

      {/* Signed/verified authorization wording — shown ONLY when the server
          check actually succeeds. A failed or unavailable check renders an
          honest boundary line instead, never a verified claim. The testid
          distinguishes executable re-verification from historical evidence. */}
      {isServerVerified(quoteVerify) ? (
        <p
          data-testid={
            quoteVerify === "evidence"
              ? "remittance-authorization-evidence"
              : "remittance-authorization-verified"
          }
          className="mt-3 text-xs font-semibold text-black"
        >
          {quoteVerifyLabel(quoteVerify)}
        </p>
      ) : (
        <p
          data-testid="remittance-authorization-boundary"
          className="mt-3 text-xs text-neutral-500"
        >
          {quoteVerifyLabel(quoteVerify)}
        </p>
      )}

      <dl className="mt-5 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-3 border-y border-black/10 py-4 text-xs">
        <dt className="text-neutral-500">Wallet transfer</dt>
        <dd className="text-black">{usdcAmount} USDC</dd>
        <dt className="text-neutral-500">Transaction mark</dt>
        <dd
          data-remittance-digest
          className="truncate font-mono text-black"
          title={settlement.digest}
          data-full={settlement.digest}
        >
          {compact(settlement.digest)}
        </dd>
        <dt className="text-neutral-500">Exchange rate</dt>
        <dd className="text-black">{quote.exchangeRate.rateText}</dd>
        <dt className="text-neutral-500">Fee</dt>
        <dd className="text-black">{fee} {quote.feeCurrency}</dd>
        <dt className="text-neutral-500">Family rule</dt>
        <dd className="text-black">{familyRuleCustomer(quote)}</dd>
        <dt className="text-neutral-500">Receipt created</dt>
        <dd className="font-mono text-black">{new Date(settlement.confirmedAt).toLocaleString()}</dd>
        <dt className="text-neutral-500">Exported</dt>
        <dd className="font-mono text-black">{new Date(ok.document.exportedAt).toLocaleString()}</dd>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {settlementVerify.status === "verified" ? (
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
          View transaction
          <ExportSquare size="13" variant="Linear" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remittance unsettled — a quote handoff, not a settlement receipt.
// ---------------------------------------------------------------------------

function RemittanceUnsettled({
  recipient,
  destinationCity,
}: {
  recipient: string | null;
  destinationCity: string | null;
}) {
  const who = recipient ? ` to ${titleCase(recipient)}` : "";
  const where = destinationCity ? ` in ${titleCase(destinationCity)}` : "";
  return (
    <div role="status" aria-live="polite" className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8">
      <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
        Quote, not a settlement
      </p>
      <h2 className="mt-2 text-2xl tracking-[-0.035em] text-black">
        This is a quote{who}{where}.
      </h2>
      <p className="mt-3 text-sm leading-6 text-neutral-600">
        A quote is not a receipt. Share and export are available only after the transfer is confirmed and a settlement receipt is produced.
      </p>
    </div>
  );
}

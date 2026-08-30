"use client";

import { useEffect, useRef, useState } from "react";
import {
  Copy,
  CopySuccess,
  DocumentDownload,
  DocumentText,
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
import { decodeHandoff } from "@/lib/remittance/offline-handoff";
import { formatMyrGrouped, formatUsdcGrouped } from "@/lib/remittance/money";
import { copyReceiptUrl, exportReceiptJson } from "@/lib/remittance/receipt-share";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";

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

type QuoteVerifyStatus =
  | "checking"
  | "verified"
  | "evidence"
  | "rejected"
  | "error";

type EvidenceView =
  | { kind: "empty" }
  | { kind: "commerce"; result: ReceiptProofResult }
  | { kind: "remittance"; result: RemittanceReceiptResult; quoteVerify: QuoteVerifyStatus }
  | {
      kind: "remittance-unsettled";
      recipient: string | null;
      destinationCity: string | null;
    };

const EMPTY_VIEW: EvidenceView = { kind: "empty" };

export function ProofVerifier() {
  const [raw, setRaw] = useState("");
  const [view, setView] = useState<EvidenceView>(EMPTY_VIEW);
  const [copied, setCopied] = useState(false);
  const [urlLoaded, setUrlLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const verifySeq = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const remittancePayload = params.get("r");
    const commercePayload = params.get("p");
    if (!remittancePayload && !commercePayload) return;
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

  const handleVerify = () => {
    setUrlLoaded(false);
    const kind = sniffProofKind(raw);
    if (kind === "remittance-receipt") {
      setView({
        kind: "remittance",
        result: verifyRemittanceReceipt(raw),
        quoteVerify: "checking",
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

  const hasEvidence = view.kind !== "empty";

  // Mobile-first evidence priority: when a result exists the verified outcome
  // is the protagonist and stacks above the JSON editor on a 390x844 viewport;
  // with no result the editor leads. Desktop keeps editor-left/evidence-right
  // via STATIC lg:order classes. The two panels are stable keyed elements
  // rendered in DOM order based on `hasEvidence`, so React reorders the DOM
  // nodes by key without remounting them (the textarea keeps focus when
  // editing clears a prior result) and no dynamically-toggled CSS `order` class
  // is involved.
  const inputPanel = (
    <div
      key="input"
      data-proof-panel="input"
      className="lg:order-first rounded-2xl border border-black/15 bg-white p-4 shadow-[0_20px_60px_rgba(0,0,0,0.06)] sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">Receipt input</p>
          <p className="mt-1 text-sm font-semibold text-black">Portable JSON evidence</p>
        </div>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-black/15 bg-white px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-black">
          <DocumentText size="15" variant="Linear" aria-hidden="true" />
          Import JSON
          <input
            ref={fileRef}
            aria-label="Import JSON"
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
      </div>

      <label htmlFor="receipt-json" className="sr-only">Receipt JSON</label>
      <textarea
        id="receipt-json"
        value={raw}
        onChange={(event) => {
          setRaw(event.target.value);
          setView(EMPTY_VIEW);
          setUrlLoaded(false);
        }}
        spellCheck={false}
        placeholder={'{\n  "digest": "…",\n  "amountMist": "…"\n}'}
        className="mt-5 min-h-56 w-full resize-y rounded-xl border border-black/15 bg-neutral-50 p-4 font-mono text-xs leading-6 text-black outline-none transition placeholder:text-neutral-400 focus:border-black sm:min-h-80"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleVerify}
          disabled={!raw.trim()}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-black px-5 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Verify structure
        </button>
        <button
          type="button"
          onClick={handleDemoSample}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-black/15 bg-white px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Load sample receipt
        </button>
        <span className="text-[11px] leading-5 text-neutral-500">No upload · No wallet · No signature</span>
      </div>
    </div>
  );

  const evidenceAside = (
    <aside
      key="evidence"
      data-proof-panel="evidence"
      className="lg:order-last min-w-0 rounded-2xl border border-black/15 bg-white p-4 sm:p-6"
      aria-label="Proof evidence"
    >
      {view.kind === "empty" ? (
        <div className="flex min-h-80 flex-col justify-between">
          <div>
            <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">Evidence panel</p>
            <h2 className="mt-3 text-2xl tracking-[-0.035em] text-black">Nothing asserted yet.</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-600">Verification begins only after you provide receipt JSON. This page does not infer settlement from a label or digest.</p>
          </div>
          <ol className="mt-8 space-y-3 text-xs text-neutral-600">
            {["Detect receipt kind", "Check canonical fields", "Bind settlement to quote", "State evidence boundary"].map((step, index) => (
              <li key={step} className="flex items-center gap-3 border-t border-black/10 pt-3">
                <span className="font-mono text-neutral-400">0{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      ) : view.kind === "commerce" ? (
        <CommerceEvidence
          result={view.result}
          urlLoaded={urlLoaded}
          copied={copied}
          onShare={handleCommerceShare}
        />
      ) : view.kind === "remittance" ? (
        <RemittanceEvidence
          result={view.result}
          quoteVerify={view.quoteVerify}
          urlLoaded={urlLoaded}
          copied={copied}
          onShare={handleRemittanceShare}
          onExport={handleRemittanceExport}
        />
      ) : (
        <RemittanceUnsettled
          recipient={view.recipient}
          destinationCity={view.destinationCity}
        />
      )}
    </aside>
  );

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
      <div className="mb-8 max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-3 py-1 font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-700">
          <ShieldSearch size="14" variant="Linear" aria-hidden="true" />
          Convey Verify
        </span>
        <h1 className="mt-4 text-4xl font-normal tracking-[-0.05em] text-black sm:text-6xl">
          Inspect the receipt.<br />Trust the boundary.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">
          Paste or import a Convey receipt — a commerce receipt or a remittance settlement. Validation runs entirely in this browser and checks structure, canonical values, and settlement-to-quote binding.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
        {hasEvidence ? [evidenceAside, inputPanel] : [inputPanel, evidenceAside]}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Commerce evidence — unchanged behavior, preserved testids.
// ---------------------------------------------------------------------------

function CommerceEvidence({
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
    return (
      <div role="alert" aria-live="assertive">
        <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">Verification stopped</p>
        <h2 className="mt-2 text-2xl tracking-[-0.035em] text-black">Receipt rejected.</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">No proof claim is made because these checks failed:</p>
        <ul className="mt-5 space-y-2">
          {result.errors.map((error) => (
            <li key={error} className="rounded-lg border border-black/15 bg-neutral-50 px-3 py-2.5 font-mono text-xs leading-5 text-black">{error}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div data-testid="proof-result" aria-live="polite">
      <div
        data-testid="proof-stage"
        data-proof-mode={result.kind === "demo_structure" ? "demo" : "real"}
        className="rounded-2xl bg-black p-5 text-white"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
            Verified amount
          </p>
          <span className="rounded-full border border-white/25 px-2.5 py-1 font-narrow text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
            {result.kind === "demo_structure" ? "LOCAL/DEMO" : "LOCAL/TESTNET"}
          </span>
        </div>
        <p className="mt-3 text-[44px] font-medium leading-[0.92] tracking-[-0.04em] sm:text-[56px]">
          {mistToSui(result.receipt.amountMist)}
          <span className="ml-2 align-baseline text-[16px] font-semibold uppercase tracking-[0.16em] text-white/60 sm:text-[18px]">
            SUI
          </span>
        </p>
        <div className="mt-4 min-w-0">
          <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
            Digest mark
          </p>
          <p
            data-proof-digest
            className="mt-1 truncate font-mono text-xs text-white"
            title={result.receipt.digest}
            data-full={result.receipt.digest}
          >
            {compact(result.receipt.digest)}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-2xl tracking-[-0.035em] text-black">
          {result.kind === "demo_structure" ? "DEMO structure verified" : "Testnet structure verified"}
        </h2>
      </div>

      <p className="mt-4 text-sm leading-6 text-neutral-600">{result.claim}</p>
      {urlLoaded ? <p className="mt-3 text-xs text-neutral-500">This proof is encoded in this URL. Nothing was retrieved from server storage.</p> : null}

      <dl className="mt-5 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-3 border-y border-black/10 py-4 text-xs">
        <dt className="text-neutral-500">Merchant</dt>
        <dd className="truncate font-mono text-black" title={result.receipt.merchantAddress}>{compact(result.receipt.merchantAddress)}</dd>
        <dt className="text-neutral-500">Exported</dt>
        <dd className="font-mono text-black">{new Date(result.document.exportedAt).toLocaleString()}</dd>
      </dl>

      <ol className="mt-5 space-y-2">
        {result.evidence.map((item, index) => (
          <li key={item.label} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-black/10 px-3 py-2.5 text-xs">
            <span className="font-mono text-neutral-400">{index + 1}</span>
            <span className="font-semibold text-black">{item.label}</span>
            <span className="text-right text-neutral-500">{item.value}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={onShare}
        className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        {copied ? <CopySuccess size="14" variant="Bold" aria-hidden="true" /> : <Copy size="14" variant="Linear" aria-hidden="true" />}
        {copied ? "Link copied" : "Copy share link"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remittance evidence — consumer-first, no engineering/demo/build language.
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

/**
 * The signed/verified authorization wording is shown ONLY when the server
 * check actually succeeds (`verified` for an unexpired quote, or `evidence`
 * for an expired-but-genuinely-attested quote). Any other state renders an
 * honest boundary line instead, so a failed or unavailable check never reads
 * as a verified authorization.
 */
function isServerVerified(status: QuoteVerifyStatus): boolean {
  return status === "verified" || status === "evidence";
}

function ruleLabel(quote: QuoteEnvelope, quoteVerify: QuoteVerifyStatus): string {
  const { purpose, maximumFamilyLimitMinor } = quote.intentReview;
  // "Bound to attested quote" is gated on server verification — the local
  // structural check only confirms the attestation field is present, not that
  // the HMAC is valid. Before the server check succeeds, use structural
  // language that does not imply cryptographic verification.
  const binding = isServerVerified(quoteVerify)
    ? "Server seal verified"
    : "Includes server seal (verification separate)";
  if (purpose && maximumFamilyLimitMinor) {
    return `Family rule · ${titleCase(purpose)} · Within RM${formatMyrGrouped(maximumFamilyLimitMinor)} maximum · ${binding}`;
  }
  if (purpose) return `Family rule · ${titleCase(purpose)} · ${binding}`;
  if (maximumFamilyLimitMinor) return `Family rule · Within RM${formatMyrGrouped(maximumFamilyLimitMinor)} maximum · ${binding}`;
  return "No family rule stated";
}

function RemittanceEvidence({
  result,
  quoteVerify,
  urlLoaded,
  copied,
  onShare,
  onExport,
}: {
  result: RemittanceReceiptResult;
  quoteVerify: QuoteVerifyStatus;
  urlLoaded: boolean;
  copied: boolean;
  onShare: () => void;
  onExport: () => void;
}) {
  if (!result.ok) {
    return (
      <div role="alert" aria-live="assertive">
        <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">Verification stopped</p>
        <h2 className="mt-2 text-2xl tracking-[-0.035em] text-black">Remittance receipt rejected.</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">No proof claim is made because these checks failed:</p>
        <ul className="mt-5 space-y-2">
          {result.errors.map((error) => (
            <li key={error} className="rounded-lg border border-black/15 bg-neutral-50 px-3 py-2.5 font-mono text-xs leading-5 text-black">{error}</li>
          ))}
        </ul>
      </div>
    );
  }

  const ok: VerifiedRemittanceReceipt = result;
  const quote = ok.document.quote;
  const settlement = ok.document.settlement;
  const usdcAmount = formatUsdcGrouped(quote.usdcMicro);
  const explorerHref = settlement.explorerUrl;

  return (
    <div data-testid="remittance-result" aria-live="polite">
      <div
        data-testid="remittance-stage"
        data-proof-mode="remittance"
        className="rounded-2xl bg-black p-5 text-white"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
            Receipt for {titleCase(quote.recipient)}
          </p>
          <span className="rounded-full border border-white/25 px-2.5 py-1 font-narrow text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
            Sui testnet
          </span>
        </div>
        <p className="mt-3 text-[44px] font-medium leading-[0.92] tracking-[-0.04em] sm:text-[56px]">
          {usdcAmount}
          <span className="ml-2 align-baseline text-[16px] font-semibold uppercase tracking-[0.16em] text-white/60 sm:text-[18px]">
            USDC
          </span>
        </p>
        <p className="mt-3 text-sm text-white/80">{titleCase(quote.destinationCity)}, {quote.destinationCountry}</p>
        <div className="mt-4 min-w-0">
          <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
            Carried transaction ID · not checked on Sui
          </p>
          <p
            data-remittance-digest
            className="mt-1 truncate font-mono text-xs text-white"
            title={settlement.digest}
            data-full={settlement.digest}
          >
            {compact(settlement.digest)}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-2xl tracking-[-0.035em] text-black">Receipt checked</h2>
      </div>

      <p className="mt-4 text-sm leading-6 text-neutral-600">{ok.claim}</p>
      {urlLoaded ? <p className="mt-3 text-xs text-neutral-500">This proof is encoded in this URL. Nothing was retrieved from server storage.</p> : null}

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
        <dt className="text-neutral-500">Recipient</dt>
        <dd className="truncate font-mono text-black" title={settlement.recipientAddress}>{compact(settlement.recipientAddress)}</dd>
        <dt className="text-neutral-500">Beneficiary</dt>
        <dd className="font-mono text-black">{settlement.beneficiaryRef}</dd>
        <dt className="text-neutral-500">Quote expiry</dt>
        <dd className="font-mono text-black">{new Date(settlement.quoteExpiresAt).toLocaleString()}</dd>
        <dt className="text-neutral-500">Payout</dt>
        <dd className="text-black">{settlement.payoutStatus}</dd>
        <dt className="text-neutral-500">Family rule</dt>
        <dd className="text-black">{ruleLabel(quote, quoteVerify)}</dd>
        <dt className="text-neutral-500">Exported</dt>
        <dd className="font-mono text-black">{new Date(ok.document.exportedAt).toLocaleString()}</dd>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onShare}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          {copied ? <CopySuccess size="14" variant="Bold" aria-hidden="true" /> : <Copy size="14" variant="Linear" aria-hidden="true" />}
          {copied ? "Link copied" : "Copy share link"}
        </button>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <DocumentDownload size="14" variant="Linear" aria-hidden="true" />
          Export proof
        </button>
        <a
          href={explorerHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          View transaction
          <ExportSquare size="13" variant="Linear" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

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
    <div role="status" aria-live="polite">
      <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">Quote, not a settlement</p>
      <h2 className="mt-2 text-2xl tracking-[-0.035em] text-black">This is a quote{who}{where}.</h2>
      <p className="mt-3 text-sm leading-6 text-neutral-600">
        A quote is not a receipt. Share and export are available only after the transfer is confirmed and a settlement receipt is produced.
      </p>
    </div>
  );
}

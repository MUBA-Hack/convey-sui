"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, CopySuccess, DocumentText, ShieldSearch } from "@/components/icons";
import {
  decodeReceiptProofPayload,
  encodeReceiptProofPayload,
  type ReceiptProofResult,
  verifyReceiptProof,
} from "@/lib/commerce/receipt-proof";

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

export function ProofVerifier() {
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<ReceiptProofResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [urlLoaded, setUrlLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const payload = new URLSearchParams(window.location.search).get("p");
    if (!payload) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const proof = decodeReceiptProofPayload(payload);
        const json = JSON.stringify(proof, null, 2);
        setRaw(json);
        setResult(verifyReceiptProof(proof));
        setUrlLoaded(true);
      } catch (error) {
        setResult({
          ok: false,
          errors: [error instanceof Error ? error.message : "Shared proof payload is invalid."],
        });
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

  const handleVerify = () => {
    setResult(verifyReceiptProof(raw));
    setUrlLoaded(false);
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
    setResult(verifyReceiptProof(sample));
    setUrlLoaded(false);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setRaw(text);
      setResult(null);
      setUrlLoaded(false);
    } catch {
      setResult({ ok: false, errors: ["The selected file could not be read."] });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleShare = async () => {
    if (!result?.ok) return;
    const payload = encodeReceiptProofPayload(result.document);
    const url = `${window.location.origin}/proof?p=${payload}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.history.replaceState({}, "", `/proof?p=${payload}`);
    }
  };

  // Mobile-first evidence priority: when a result exists the verified outcome
  // is the protagonist and stacks above the JSON editor on a 390x844 viewport;
  // with no result the editor leads. Desktop keeps editor-left/evidence-right
  // via STATIC lg:order classes. The two panels are stable keyed elements
  // rendered in DOM order based on `result`, so React reorders the DOM nodes by
  // key without remounting them (the textarea keeps focus when editing clears a
  // prior result) and no dynamically-toggled CSS `order` class is involved.
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
              setResult(null);
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
          {!result ? (
            <div className="flex min-h-80 flex-col justify-between">
              <div>
                <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">Evidence panel</p>
                <h2 className="mt-3 text-2xl tracking-[-0.035em] text-black">Nothing asserted yet.</h2>
                <p className="mt-3 text-sm leading-6 text-neutral-600">Verification begins only after you provide receipt JSON. This page does not infer settlement from a label or digest.</p>
              </div>
              <ol className="mt-8 space-y-3 text-xs text-neutral-600">
                {["Parse strict schema", "Check canonical fields", "Reconcile mode and explorer", "State evidence boundary"].map((step, index) => (
                  <li key={step} className="flex items-center gap-3 border-t border-black/10 pt-3">
                    <span className="font-mono text-neutral-400">0{index + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          ) : result.ok ? (
            <div data-testid="proof-result" aria-live="polite">
              {/* Black verification stage — the mobile first viewport
                  protagonist. It leads with amount, a single digest mark,
                  and an honest LOCAL/DEMO or LOCAL/TESTNET boundary label.
                  The long explainer follows below. */}
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
                onClick={() => void handleShare()}
                className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                {copied ? <CopySuccess size="14" variant="Bold" aria-hidden="true" /> : <Copy size="14" variant="Linear" aria-hidden="true" />}
                {copied ? "Link copied" : "Copy share link"}
              </button>
            </div>
          ) : (
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
          Paste or import a Convey receipt. Validation runs entirely in this browser and checks structure, canonical values, mode, and explorer consistency.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
        {result ? [evidenceAside, inputPanel] : [inputPanel, evidenceAside]}
      </div>
    </section>
  );
}

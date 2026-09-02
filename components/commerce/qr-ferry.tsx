"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PurchaseIntentPreview } from "@/lib/commerce/intent";
import {
  createEnvelope,
  exportEnvelopeJson,
  importEnvelope,
  QrFerryError,
  type QrFerryEnvelope,
  type ReplayRegistry,
} from "@/lib/commerce/qr-ferry";
import {
  decodeHandoff,
  RemittanceHandoffError,
  sniffHandoffKind,
} from "@/lib/remittance/offline-handoff";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import { ArrowRight2 } from "@/components/icons";
import { cn } from "@/lib/utils";
import { PaymentAction } from "./payment-action";
import { QrScanner } from "./qr-scanner";
import { RemittanceHandoffCard } from "@/components/remittance/remittance-handoff-card";
import { parseQrTaskEnvelope, type QrTaskEnvelope } from "@/lib/commerce/qr-task";
import { QrTaskStudio } from "./qr-task-studio";

// --- Demo purchase (simulation) -------------------------------------------

/** 1 SUI = 1e9 MIST. */
const MIST_PER_SUI = 1_000_000_000n;

/**
 * Deterministic demo merchant address. The catalog carries `address: null`
 * in simulation mode; the QR Ferry envelope requires a valid Sui address, so
 * we use this explicitly-labelled simulation address. This is NOT a claim of
 * a real testnet deployment.
 */
const DEMO_MERCHANT_ADDRESS = "0x".concat("11".repeat(32)) as `0x${string}`;

const DEMO_ITEM = "Iced Coffee";
const DEMO_QUANTITY = 2;
const DEMO_UNIT_PRICE_MIST = 3n * MIST_PER_SUI; // 3 SUI
const DEMO_TOTAL_MIST = BigInt(DEMO_QUANTITY) * DEMO_UNIT_PRICE_MIST; // 6 SUI
const DEMO_MERCHANT_NAME = "River Cafe";

/** Envelope lifetime (1 hour, well under the 24h cap). */
const EXPIRY_WINDOW_MS = 60 * 60 * 1000;

// --- localStorage-backed ReplayRegistry -----------------------------------

/**
 * localStorage key under which consumed nonces are persisted. Exported so
 * tests can seed/clear the exact key without hardcoding it.
 */
export const NONCE_STORAGE_KEY = "cv-qr-ferry-consumed-nonces";

/**
 * Why replay protection is unavailable. Surfaced to the UI so the warning
 * can distinguish "the stored blob was not valid JSON" from "the stored blob
 * parsed but was not a string array" — both are fail-closed conditions.
 */
export type ReplayDegradedReason = "corrupt_json" | "wrong_shape";

/**
 * `unknown` -> `string[]` narrowing. The previous implementation trusted a
 * `JSON.parse(raw) as string[]` cast, which let non-array values (numbers,
 * objects, arrays of non-strings) silently become an empty/oddly-shaped Set
 * — a fail-OPEN condition. This guard is the boundary check that closes it.
 */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * ReplayRegistry backed by localStorage so consumed nonces survive page
 * refresh. Demo scope only — production requires an on-chain nonce registry
 * or trusted sponsor index.
 *
 * SECURITY: if the persisted blob is missing, corrupt, or wrong-shaped, the
 * registry enters a DEGRADED, FAIL-CLOSED state. While degraded,
 * `tryConsume` rejects every nonce (returns false) so no envelope can be
 * imported — replay validation is unavailable rather than silently bypassed.
 * The UI must surface a `role=alert` warning and offer an explicit recovery
 * action (`recover`) that clears ONLY this key and reconstructs protection.
 * The registry never auto-accepts a nonce to "recover" itself.
 */
class LocalStorageReplayRegistry implements ReplayRegistry {
  private seen: Set<string>;
  private degradedReason: ReplayDegradedReason | null;

  constructor() {
    const { seen, degradedReason } = LocalStorageReplayRegistry.assess();
    this.seen = seen;
    this.degradedReason = degradedReason;
  }

  /**
   * Single source of truth for reading persisted replay state. Returns the
   * reconstructed `seen` set and the fail-closed degraded reason (null when
   * healthy). Also used by the static `isStorageDegraded` probe so the UI can
   * initialize its degraded flag without touching a ref during render.
   */
  private static assess(): {
    seen: Set<string>;
    degradedReason: ReplayDegradedReason | null;
  } {
    let raw: string | null;
    try {
      raw = localStorage.getItem(NONCE_STORAGE_KEY);
    } catch {
      // localStorage itself unavailable (disabled, private mode quota). We
      // cannot know prior consumed nonces, so fail closed rather than start
      // empty and accept replays.
      return { seen: new Set(), degradedReason: "corrupt_json" };
    }
    if (raw === null) {
      // No prior state — fresh install. Not degraded.
      return { seen: new Set(), degradedReason: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt JSON blob. Fail closed; do not silently reset.
      return { seen: new Set(), degradedReason: "corrupt_json" };
    }
    if (!isStringArray(parsed)) {
      // Parsed but not a string[] (e.g. an object, number, or mixed array).
      // Fail closed; do not silently reset.
      return { seen: new Set(), degradedReason: "wrong_shape" };
    }
    return { seen: new Set(parsed), degradedReason: null };
  }

  /**
   * UI-side probe: true when persisted replay storage is corrupt or
   * wrong-shaped and imports must be blocked. Safe to call during render
   * (it does not touch any React ref).
   */
  static isStorageDegraded(): boolean {
    return LocalStorageReplayRegistry.assess().degradedReason !== null;
  }

  /** True when replay protection is unavailable and imports must be blocked. */
  isDegraded(): boolean {
    return this.degradedReason !== null;
  }

  /** The specific fail-closed reason, or null when protection is healthy. */
  degradedState(): ReplayDegradedReason | null {
    return this.degradedReason;
  }

  tryConsume(nonce: string): boolean {
    if (this.degradedReason !== null) {
      // Fail closed: never accept a nonce while replay protection is
      // unavailable. The UI must surface the degraded warning and offer
      // explicit recovery before any import can succeed.
      return false;
    }
    if (this.seen.has(nonce)) return false;
    this.seen.add(nonce);
    try {
      localStorage.setItem(
        NONCE_STORAGE_KEY,
        JSON.stringify([...this.seen]),
      );
    } catch {
      // Storage full or unavailable — the in-memory set still defends this
      // session. We do not silently drop the consume decision.
    }
    return true;
  }

  /**
   * Explicit recovery: clears ONLY the QR nonce key from localStorage and
   * reconstructs a fresh, non-degraded empty registry in place. Other
   * localStorage entries are untouched. After this, replay protection is
   * healthy (empty) and imports can proceed.
   */
  recover(): void {
    try {
      localStorage.removeItem(NONCE_STORAGE_KEY);
    } catch {
      // Best effort; the in-memory state is still reset below.
    }
    this.seen = new Set();
    this.degradedReason = null;
  }
}

// --- Helpers ---------------------------------------------------------------

/** Generate a unique nonce, preferring crypto.randomUUID when available. */
function generateNonce(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Format a MIST string as a human-readable SUI amount (trailing zeros trimmed). */
function mistToSui(mist: string): string {
  const big = BigInt(mist);
  const sui = big / MIST_PER_SUI;
  const fraction = big % MIST_PER_SUI;
  if (fraction === 0n) return sui.toString();
  return `${sui}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

/** Format epoch ms as a locale string. */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Shorten a long hex identifier for display; full value stays in title. */
function shortId(value: string, head = 10, tail = 8): string {
  if (value.length <= 22) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Friendly error messages keyed by QrFerryError reason. */
const FRIENDLY_ERRORS: Record<string, string> = {
  duplicate_nonce:
    "Already used. This envelope's nonce was already consumed (replay rejected).",
  expired: "Expired. This envelope has passed its expiry time.",
  checksum_mismatch:
    "Checksum mismatch. The payload may have been tampered with.",
  malformed_json: "Malformed JSON. The payload is not valid JSON.",
  unsupported_version:
    "Unsupported version. This envelope uses an unknown wire version.",
  invalid_shape: "Invalid shape. The payload is not a well-formed envelope.",
  invalid_merchant: "Invalid merchant address.",
  invalid_payer: "Invalid payer address.",
  invalid_amount: "Invalid amount.",
  invalid_quantity: "Invalid quantity.",
  invalid_item: "Invalid item.",
  invalid_nonce: "Invalid nonce.",
  invalid_timestamps: "Invalid timestamps.",
  future:
    "Future-dated. This envelope's creation time is too far ahead of now.",
};

function errorMessage(err: unknown): string {
  if (err instanceof QrFerryError) {
    return FRIENDLY_ERRORS[err.reason] ?? err.message;
  }
  return err instanceof Error ? err.message : "Import failed.";
}

const REMITTANCE_HANDOFF_ERRORS: Record<string, string> = {
  malformed_json: "Malformed JSON. The carried quote is not valid JSON.",
  oversized: "Oversized. The carried quote payload is too large.",
  wrong_kind: "Wrong kind. This payload is not a carried remittance quote.",
  unsupported_version: "Unsupported version. This carried quote uses an unknown version.",
  invalid_shape: "Invalid shape. The carried quote is not well-formed.",
};

function remittanceHandoffErrorMessage(err: unknown): string {
  if (err instanceof RemittanceHandoffError) {
    return REMITTANCE_HANDOFF_ERRORS[err.reason] ?? err.message;
  }
  return err instanceof Error ? err.message : "Import failed.";
}

// --- Component -------------------------------------------------------------

export interface QrFerryProps {
  /**
   * Called with the validated envelope after a successful import. The
   * validated envelope is then handed into the same guarded checkout/proof
   * path the home chat uses (via the Continue to checkout button below).
   */
  onValidatedEnvelope?: (env: QrFerryEnvelope) => void;
}

type ImportedPayment =
  | { kind: "commerce"; envelope: QrFerryEnvelope }
  | { kind: "remittance"; quote: QuoteEnvelope }
  | { kind: "task"; task: QrTaskEnvelope };

export function QrFerry({ onValidatedEnvelope }: QrFerryProps = {}) {
  const [envelope, setEnvelope] = useState<QrFerryEnvelope | null>(null);
  const [payload, setPayload] = useState("");
  const [importedPayment, setImportedPayment] = useState<ImportedPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutPreview, setCheckoutPreview] = useState<PurchaseIntentPreview | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const imported =
    importedPayment?.kind === "commerce" ? importedPayment.envelope : null;
  const importedRemittance =
    importedPayment?.kind === "remittance" ? importedPayment.quote : null;
  const importedTask = importedPayment?.kind === "task" ? importedPayment.task : null;

  const registryRef = useRef<LocalStorageReplayRegistry | null>(null);
  const importedUrlRef = useRef(false);
  const [, setReplayRevision] = useState(0);
  const replayDegraded = useSyncExternalStore(
    () => () => {},
    () => LocalStorageReplayRegistry.isStorageDegraded(),
    () => false,
  );

  const handleGenerate = () => {
    const now = Date.now();
    const env = createEnvelope({
      item: DEMO_ITEM,
      quantity: DEMO_QUANTITY,
      totalMist: DEMO_TOTAL_MIST,
      merchantAddress: DEMO_MERCHANT_ADDRESS,
      nonce: generateNonce(),
      createdAt: now,
      expiresAt: now + EXPIRY_WINDOW_MS,
    });
    setEnvelope(env);
  };

  const handleCopy = async () => {
    if (!envelope) return;
    const json = exportEnvelopeJson(envelope);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      // Clipboard may be unavailable; the payload is still visible for manual copy.
    }
  };

  const handleDownload = () => {
    if (!envelope) return;
    const json = exportEnvelopeJson(envelope);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qr-ferry-envelope.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value so re-selecting the identical file (including
    // after a prior parse failure) still fires onChange and repopulates the
    // textarea. The File reference is already held locally, so clearing the
    // input's value does not invalidate it.
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    setPayload(text);
  };

  const runImport = useCallback((raw: string) => {
    if (replayDegraded) return;

    const task = parseQrTaskEnvelope(raw);
    if (task) {
      setImportedPayment({ kind: "task", task });
      setCheckoutPreview(null);
      setError(null);
      setPayload("");
      return;
    }

    const kind = sniffHandoffKind(raw);
    if (kind === "convey.remittance-quote") {
      try {
        const handoff = decodeHandoff(raw);
        setImportedPayment({ kind: "remittance", quote: handoff.quote });
        setCheckoutPreview(null);
        setError(null);
        setPayload("");
      } catch (err) {
        setImportedPayment(null);
        setError(remittanceHandoffErrorMessage(err));
        setManualOpen(true);
      }
      return;
    }

    try {
      const registry = registryRef.current ?? new LocalStorageReplayRegistry();
      registryRef.current = registry;
      const env = importEnvelope(raw, {
        registry,
      });
      setImportedPayment({ kind: "commerce", envelope: env });
      setCheckoutPreview(null);
      setError(null);
      setPayload("");
      onValidatedEnvelope?.(env);
    } catch (err) {
      setImportedPayment(null);
      setError(errorMessage(err));
      setManualOpen(true);
    }
  }, [onValidatedEnvelope, replayDegraded]);

  const handleImport = () => {
    runImport(payload);
  };

  const handleScanned = (text: string) => {
    setPayload(text);
    runImport(text);
  };

  useEffect(() => {
    if (importedUrlRef.current) return;
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return;
    const timer = window.setTimeout(() => {
      if (importedUrlRef.current) return;
      importedUrlRef.current = true;
      runImport(code);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [runImport]);

  const handoffToCheckout = () => {
    if (!imported) return;
    const quantity = imported.quantity;
    const totalMist = BigInt(imported.totalMist);
    setCheckoutPreview({
      kind: "preview",
      action: "buy",
      item: { id: "qr-ferry-imported", name: imported.item },
      quantity,
      unitPriceMist: (totalMist / BigInt(quantity)).toString(),
      totalMist: imported.totalMist,
      priceCeilingMist: null,
      merchant: {
        id: imported.merchantAddress,
        name: DEMO_MERCHANT_NAME,
        address: imported.merchantAddress,
      },
      confidence: 1,
      clarification: null,
    });
  };

  /**
   * Explicit recovery for the fail-closed degraded state. Clears ONLY the
   * QR nonce key from localStorage and reconstructs a fresh, healthy
   * (empty) registry. Other localStorage entries are untouched.
   */
  const handleRecoverReplayStorage = () => {
    const registry = registryRef.current ?? new LocalStorageReplayRegistry();
    registryRef.current = registry;
    registry.recover();
    setReplayRevision((value) => value + 1);
    setError(null);
    setImportedPayment(null);
  };

  const handleScanAnother = () => {
    setImportedPayment(null);
    setCheckoutPreview(null);
    setError(null);
    setPayload("");
    setManualOpen(false);
    setCreateOpen(false);
  };

  const envelopeJson = envelope ? exportEnvelopeJson(envelope) : "";
  const pageIdentity = importedRemittance
    ? { eyebrow: "Quote carried", title: "Continue to Ana" }
    : imported
      ? { eyebrow: "Payment carried", title: "Review and pay" }
      : importedTask
        ? { eyebrow: "QR request opened", title: "Review the details" }
        : { eyebrow: "Offline-ready QR", title: "Scan, pay, or collect" };

  return (
    <section className="cv-shell mx-auto w-full max-w-[1040px] px-4 pt-5 md:pt-8">
      <header className="mb-5 flex flex-col gap-1 px-1">
        <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
          {pageIdentity.eyebrow}
        </p>
        <h1 className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.04em] text-black sm:text-[40px]">
          {pageIdentity.title}
        </h1>
      </header>

      {importedTask ? (
        <div role="status" className="cv-money-sheet cv-preview-in overflow-hidden rounded-2xl bg-white p-5">
          <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            {importedTask.task === "split" ? "Personal split request" : importedTask.task === "allowance" ? "Purpose allowance" : importedTask.task === "pass" ? "Conditional payment pass" : "Payment request"}
          </p>
          <div className="mt-4 rounded-xl bg-black p-5 text-white">
            <span className="text-xs text-white/58">{importedTask.recipient ?? importedTask.beneficiary ?? "Receive"}</span>
            <strong className="mt-1 block text-3xl font-semibold tracking-[-0.04em]">
              {importedTask.amount ?? importedTask.limit} {importedTask.asset}
            </strong>
            {(importedTask.note || importedTask.category || importedTask.condition) && (
              <span className="mt-2 block text-sm text-white/65">{importedTask.note ?? importedTask.category ?? importedTask.condition}</span>
            )}
          </div>
          <p className="mt-4 text-sm leading-6 text-neutral-600">
            Check the person, amount, and purpose. Opening this QR does not approve or move funds.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Link href={`/app?request=${encodeURIComponent(`Pay ${importedTask.recipient ?? importedTask.beneficiary ?? "this request"} ${importedTask.amount ?? importedTask.limit} ${importedTask.asset}${importedTask.note ? ` for ${importedTask.note}` : ""}`)}`} className="cv-btn-solid flex min-h-12 items-center justify-center px-4 text-xs font-semibold">
              Prepare in assistant
            </Link>
            <button type="button" onClick={handleScanAnother} className="cv-btn-ghost min-h-12 px-4 text-xs font-semibold">Scan another</button>
          </div>
        </div>
      ) : importedRemittance ? (
        <>
          <RemittanceHandoffCard quote={importedRemittance} />
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              data-hit-target="true"
              data-testid="scan-another"
              onClick={handleScanAnother}
              className="cv-btn-ghost inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            >
              Scan another
            </button>
          </div>
        </>
      ) : imported ? (
        <div
          data-testid="validated-envelope"
          role="status"
          className="cv-money-sheet cv-preview-in overflow-hidden rounded-2xl bg-white p-4"
        >
          <p className="cv-micro cv-micro-sm text-neutral-500">
            Payment approved
          </p>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-neutral-500">Item</dt>
              <dd className="font-medium">{imported.item}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Quantity</dt>
              <dd className="font-mono tabular-nums">
                {imported.quantity}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Total</dt>
              <dd className="font-mono tabular-nums">
                {mistToSui(imported.totalMist)} SUI
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Merchant</dt>
              <dd className="font-medium">{DEMO_MERCHANT_NAME}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-neutral-500">Expires</dt>
              <dd className="text-right font-mono text-xs">
                {formatTime(imported.expiresAt)}
              </dd>
            </div>
          </dl>

          <details className="mt-3 border-t border-black/8 pt-3 text-sm">
            <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600">
              Technical details
            </summary>
            <dl className="mt-3 flex flex-col gap-2">
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-neutral-500">Merchant address</dt>
                <dd
                  className="min-w-0 break-all text-right font-mono text-xs"
                  title={imported.merchantAddress}
                >
                  {shortId(imported.merchantAddress)}
                </dd>
              </div>
              {imported.payerAddress && (
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-neutral-500">Payer address</dt>
                  <dd
                    className="min-w-0 break-all text-right font-mono text-xs"
                    title={imported.payerAddress}
                  >
                    {shortId(imported.payerAddress)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-neutral-500">Nonce</dt>
                <dd
                  className="min-w-0 break-all text-right font-mono text-xs"
                  title={imported.nonce}
                >
                  {shortId(imported.nonce)}
                </dd>
              </div>
            </dl>
          </details>

          <p className="mt-4 border-t border-black/8 pt-3 text-sm font-semibold">
            Ready to hand off into the same guarded checkout
          </p>
          <button
            type="button"
            data-hit-target="true"
            onClick={handoffToCheckout}
            className="cv-btn-ghost mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          >
            Continue to checkout
          </button>
          <p className="mt-2 text-xs text-neutral-500">
            The connected device still applies the same payment gate and
            proof as the home chat before anything settles.
          </p>

          <div className="mt-4 flex justify-center border-t border-black/8 pt-3">
            <button
              type="button"
              data-hit-target="true"
              data-testid="scan-another"
              onClick={handleScanAnother}
              className="cv-btn-ghost inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            >
              Scan another
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            data-testid="scan-card"
            className="cv-money-sheet cv-preview-in overflow-hidden rounded-2xl"
          >
            <div className="px-5 pt-5 pb-3">
              <h2 className="text-sm font-semibold tracking-[-0.01em] text-black">
                Scan and pay
              </h2>
              <p className="mt-1 text-[12px] text-neutral-500">
                Scan a payment, personal request, split, allowance, or pass. You review every detail before approval.
              </p>
            </div>

            {/* Fail-closed degraded warning: replay protection is unavailable
                until the user explicitly resets the local protection key. No
                nonce is auto-accepted. */}
            {replayDegraded && (
              <div
                role="alert"
                data-testid="replay-degraded-warning"
                className="mx-5 rounded-lg border border-black bg-white p-4 text-sm leading-relaxed text-black"
              >
                <p className="font-semibold">
                  Payment protection unavailable
                </p>
                <p className="mt-1">
                  This device&apos;s replay protection could not be loaded.
                  its stored data is corrupt, so approving a payment is
                  blocked until protection is deliberately reset. No payment
                  can be accepted until then.
                </p>
                <button
                  type="button"
                  data-hit-target="true"
                  onClick={handleRecoverReplayStorage}
                  className="cv-btn-ghost mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
                >
                  Reset protection
                </button>
                <p className="mt-2 text-neutral-500">
                  This clears only the local replay key and reconstructs
                  protection. Other stored data is untouched.
                </p>
              </div>
            )}

            <div className="px-5 pb-5">
              <QrScanner onDecode={handleScanned} disabled={replayDegraded} />
            </div>

            {error && (
              <div
                role="alert"
                className="mx-5 mb-5 rounded-lg border border-black bg-white p-4 text-sm font-medium text-black"
              >
                {error}
              </div>
            )}
          </div>

          <QrTaskStudio />

          <div className="mt-4 overflow-hidden rounded-xl border border-black/8 bg-[var(--cv-paper)]">
            <button
              type="button"
              data-hit-target="true"
              data-testid="manual-entry-disclosure"
              aria-expanded={manualOpen}
              onClick={() => setManualOpen((v) => !v)}
              className="flex w-full min-h-[44px] items-center justify-between gap-3 px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600 transition-colors hover:bg-neutral-50"
            >
              <span>Enter manually</span>
              <ArrowRight2
                size={14}
                variant="Linear"
                className={cn(
                  "shrink-0 text-neutral-400 transition-transform",
                  manualOpen && "rotate-90",
                )}
              />
            </button>
            {manualOpen && (
              <div className="px-4 pb-4">
                <div>
                  <label
                    htmlFor="qr-ferry-payload"
                    className="cv-micro cv-micro-sm text-neutral-500"
                  >
                    Paste payment code
                  </label>
                  <textarea
                    id="qr-ferry-payload"
                    placeholder="Paste payment code…"
                    value={payload}
                    onChange={(e) => setPayload(e.target.value)}
                    rows={6}
                    className="mt-1 w-full resize-y rounded-lg border border-black/10 bg-white p-3 font-mono text-xs"
                  />
                </div>

                <div className="mt-3">
                  <label
                    htmlFor="qr-ferry-file"
                    className="cv-micro cv-micro-sm text-neutral-500"
                  >
                    Open from file
                  </label>
                  <input
                    id="qr-ferry-file"
                    type="file"
                    accept=".json,.txt,application/json,text/plain"
                    onChange={handleFile}
                    className="mt-1 block w-full text-sm file:min-h-11 file:mr-3 file:rounded-lg file:border file:border-black/14 file:bg-white file:px-4 file:py-2 file:font-semibold file:text-black hover:file:bg-neutral-100"
                  />
                </div>

                <button
                  type="button"
                  data-hit-target="true"
                  onClick={handleImport}
                  disabled={replayDegraded || payload.trim().length === 0}
                  className="cv-btn-ghost mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:text-neutral-400"
                >
                  Open payment
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-black/8 bg-[var(--cv-paper)]">
            <button
              type="button"
              data-hit-target="true"
              data-testid="create-shop-payment-disclosure"
              aria-expanded={createOpen}
              onClick={() => setCreateOpen((v) => !v)}
              className="flex w-full min-h-[44px] items-center justify-between gap-3 px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600 transition-colors hover:bg-neutral-50"
            >
              <span>Create a shop payment</span>
              <ArrowRight2
                size={14}
                variant="Linear"
                className={cn(
                  "shrink-0 text-neutral-400 transition-transform",
                  createOpen && "rotate-90",
                )}
              />
            </button>
            {createOpen && (
              <div
                data-testid="generate-panel"
                className="cv-money-sheet cv-preview-in overflow-hidden rounded-2xl"
              >
                {/* Identity row — River Cafe / Iced Coffee */}
                <div className="flex items-center gap-3 px-5 pt-5 pb-4">
                  <span
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black text-sm font-semibold text-white"
                  >
                    RC
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold tracking-[-0.01em] text-black">
                      {DEMO_MERCHANT_NAME}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-neutral-500">
                      {DEMO_ITEM}
                    </p>
                  </div>
                </div>

                {/* Black figure block — 6 SUI + Pay when connected state */}
                <div className="cv-money-tile mx-5 rounded-[18px] bg-black p-4 text-white">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
                    Pay when connected
                  </p>
                  <div className="mt-1 font-sans text-[32px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white">
                    {mistToSui(DEMO_TOTAL_MIST.toString())} SUI
                  </div>
                  <p className="mt-2 text-[12px] text-white/55">Offline payment</p>
                </div>

                {/* Labeled rows — quantity, merchant, approval */}
                <dl className="space-y-1.5 px-5 pt-3 pb-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-neutral-500">Quantity</dt>
                    <dd className="font-sans font-medium tabular-nums text-neutral-700">
                      {DEMO_QUANTITY}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-neutral-500">Merchant</dt>
                    <dd className="text-right text-neutral-700">{DEMO_MERCHANT_NAME}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-neutral-500">Approval</dt>
                    <dd className="text-right text-neutral-700">
                      On connected device
                    </dd>
                  </div>
                </dl>

                {/* Constraint strip — payment code protects details, still needs approval */}
                <p className="px-5 pb-3 text-[11px] leading-relaxed text-neutral-500">
                  The payment code protects details from changes and still
                  requires approval on a connected device.
                </p>

                {/* Primary action */}
                {!envelope && (
                  <div className="px-5 pb-5">
                    <button
                      type="button"
                      data-hit-target="true"
                      onClick={handleGenerate}
                      className="cv-btn-solid inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
                    >
                      Create payment QR
                    </button>
                  </div>
                )}

                {/* After generation — QR within the same card/state */}
                {envelope && (
                  <div className="border-t border-black/8 p-5">
                    <div className="flex justify-center rounded-xl border border-black/8 bg-white p-4">
                      <QRCodeSVG
                        value={envelopeJson}
                        size={200}
                        level="M"
                        marginSize={4}
                        fgColor="#000000"
                        bgColor="#ffffff"
                        title="Offline payment code"
                      />
                    </div>

                    {/* Quiet secondary actions */}
                    <div className="mt-3 flex gap-3">
                      <button
                        type="button"
                        data-hit-target="true"
                        onClick={handleCopy}
                        className="cv-btn-ghost inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
                      >
                        Copy code
                      </button>
                      <button
                        type="button"
                        data-hit-target="true"
                        onClick={handleDownload}
                        className="cv-btn-ghost inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
                      >
                        Download code
                      </button>
                    </div>

                    {/* Technical details — collapsed, off the default flow */}
                    <details className="mt-4 rounded-lg border border-black/8 p-4 text-sm">
                      <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600">
                        Technical details
                      </summary>
                      <div className="mt-3 flex flex-col gap-4">
                        <div>
                          <p className="cv-micro cv-micro-sm text-neutral-500">
                            Payment code (JSON)
                          </p>
                          <pre
                            data-testid="envelope-payload"
                            className="mt-1 max-h-48 overflow-auto rounded-lg border border-black/8 bg-[var(--cv-paper)] p-3 font-mono text-xs whitespace-pre-wrap break-all"
                          >
                            {envelopeJson}
                          </pre>
                        </div>

                        <div>
                          <p className="cv-micro cv-micro-sm text-neutral-500">
                            Envelope details
                          </p>
                          <dl className="mt-3 flex flex-col gap-2">
                            <div className="flex justify-between gap-3">
                              <dt className="shrink-0 text-neutral-500">Merchant address</dt>
                              <dd
                                className="min-w-0 break-all text-right font-mono text-xs"
                                title={DEMO_MERCHANT_ADDRESS}
                              >
                                {shortId(DEMO_MERCHANT_ADDRESS)}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt className="shrink-0 text-neutral-500">Unit price</dt>
                              <dd className="font-mono tabular-nums">
                                {mistToSui(DEMO_UNIT_PRICE_MIST.toString())} SUI
                              </dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt className="shrink-0 text-neutral-500">Nonce</dt>
                              <dd
                                className="min-w-0 break-all text-right font-mono text-xs"
                                title={envelope.nonce}
                              >
                                {shortId(envelope.nonce)}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt className="shrink-0 text-neutral-500">Created</dt>
                              <dd className="text-right font-mono text-xs">
                                {formatTime(envelope.createdAt)}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt className="shrink-0 text-neutral-500">Expires</dt>
                              <dd className="text-right font-mono text-xs">
                                {formatTime(envelope.expiresAt)}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt className="shrink-0 text-neutral-500">Checksum</dt>
                              <dd
                                className="min-w-0 break-all text-right font-mono text-xs"
                                title={envelope.checksum}
                              >
                                {shortId(envelope.checksum)}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* How offline payment works — collapsed accuracy caveats, near the
          bottom. Not a hero essay. */}
      <details className="mt-4 rounded-xl border border-black/8 bg-[var(--cv-paper)] p-4 text-sm leading-relaxed text-neutral-700">
        <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600">
          How offline payment works
        </summary>
        <div
          data-testid="transport-explanation"
          className="mt-3 flex flex-col gap-2"
        >
          <p>
            The payment code is a <strong>tamper-evident transport
            envelope</strong>, not cryptographic payer authorization. A
            checksum detects any change to the item, quantity, amount, or
            merchant, and a consume-once code prevents the same payment from
            being approved twice. No signature or authorization is implied.
            the connected device must still approve any payment.
          </p>
          <p className="text-neutral-500">
            This prototype uses device-local replay protection, so it persists
            across refresh on this device but is not shared across devices. A
            production rollout would use an on-chain registry or trusted
            sponsor index.
          </p>
        </div>
      </details>

      {checkoutPreview && (
        <div className="mt-4 rounded-xl border border-black/10 bg-white p-4 md:p-5">
          <div className="mb-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
              Same guarded checkout
            </p>
            <h2 className="mt-1 text-lg font-medium tracking-tight">
              Settle the imported purchase
            </h2>
          </div>
          <PaymentAction preview={checkoutPreview} />
        </div>
      )}
    </section>
  );
}
